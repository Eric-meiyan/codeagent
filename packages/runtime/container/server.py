import base64
import hashlib
import io
import json
import os
import pty
import pwd
import re
import select
import shlex
import shutil
import signal
import socket
import socketserver
import struct
import subprocess
import tarfile
import termios
import threading
import uuid
import fcntl
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path, PurePosixPath
from typing import Optional
from urllib.parse import unquote, urlparse, parse_qs

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ROOT = Path("/workspace/sessions")
CLAUDE_CHUNK_DIR = Path("/opt/claude-code/chunks")
CLAUDE_BIN = Path("/tmp/claude-code/claude")
CLAUDE_VERSION = "2.1.197"
CODEX_BIN = Path("/usr/local/bin/codex")
CODEX_VERSION = "0.39.0"
CODEX_MODEL = os.environ.get("CODEX_MODEL", "gpt-5.1-codex")
CODEX_BASE_URL = os.environ.get("CODEX_BASE_URL", "https://yunwu.ai/v1")
CODEX_PROVIDER = os.environ.get("CODEX_PROVIDER", "yunwu")
CLAUDE_LOCK = threading.Lock()
RUNTIME_USER = "appuser"
_RUNTIME_USER_INFO = None
DEFAULT_TERMINAL_ROWS = 30
DEFAULT_TERMINAL_COLS = 120
MIN_TERMINAL_ROWS = 5
MAX_TERMINAL_ROWS = 80
MIN_TERMINAL_COLS = 20
MAX_TERMINAL_COLS = 240
AGENTS = {"claude", "codex"}
ARCHIVE_FORMAT = "2"
ARCHIVE_EXCLUDED_DIR_NAMES = {
    ".cache",
    ".npm",
    ".pnpm-store",
    ".pytest_cache",
    ".turbo",
    "__pycache__",
    "node_modules",
}
ARCHIVE_EXCLUDED_PATHS = {
    (".next", "cache"),
    (".yarn", "cache"),
}


class RuntimeOperationError(Exception):
    def __init__(
        self, code: str, stage: str, message: str, status: int = 500, details=None
    ):
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.status = status
        self.details = details or {}


def safe_name(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "_", raw)[:80] or "default"


def safe_agent(raw: Optional[str]) -> str:
    return raw if raw in AGENTS else "claude"


def safe_model(raw: Optional[str], fallback: str = "") -> str:
    model = (raw or "").strip()
    if not model:
        return fallback
    if len(model) > 160:
        return fallback
    if not re.match(r"^[a-zA-Z0-9_.:/@+-]+$", model):
        return fallback
    return model


def session_name(session_id: str, agent: str = "claude") -> str:
    prefix = "cx" if safe_agent(agent) == "codex" else "ca"
    return f"{prefix}_{safe_name(session_id)}"


def session_path(session_id: str) -> Path:
    return ROOT / safe_name(session_id)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(handler, status: int, data):
    body = json.dumps(data, indent=2).encode()
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def write_runtime_error(handler, error: Exception, default_stage: str):
    if isinstance(error, RuntimeOperationError):
        status = error.status
        code = error.code
        stage = error.stage
        details = error.details
        message = str(error)
    else:
        status = 500
        code = "runtime_internal_error"
        stage = default_stage
        details = {}
        message = str(error) or "Runtime operation failed"

    payload = {
        "ok": False,
        "error": message,
        "code": code,
        "stage": stage,
        "details": details,
    }
    print(json.dumps({"event": "runtime.operation.failed", **payload}), flush=True)
    write_json(handler, status, payload)


def encode_frame(data: bytes) -> bytes:
    length = len(data)
    if length < 126:
        return bytes([0x82, length]) + data
    if length < 65536:
        return bytes([0x82, 126]) + struct.pack("!H", length) + data
    return bytes([0x82, 127]) + struct.pack("!Q", length) + data


def decode_frame(sock: socket.socket):
    header = sock.recv(2)
    if not header:
        return None
    first, second = header
    opcode = first & 0x0F
    masked = second & 0x80
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    mask = sock.recv(4) if masked else b""
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            return None
        payload += chunk
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    if opcode == 8:
        return None
    return payload.decode("utf-8", errors="ignore")


def set_winsize(fd: int, rows: int, cols: int):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def terminal_size(rows, cols):
    try:
        parsed_rows = int(rows)
    except (TypeError, ValueError):
        parsed_rows = DEFAULT_TERMINAL_ROWS
    try:
        parsed_cols = int(cols)
    except (TypeError, ValueError):
        parsed_cols = DEFAULT_TERMINAL_COLS
    return (
        max(MIN_TERMINAL_ROWS, min(MAX_TERMINAL_ROWS, parsed_rows)),
        max(MIN_TERMINAL_COLS, min(MAX_TERMINAL_COLS, parsed_cols)),
    )


def runtime_user_info():
    global _RUNTIME_USER_INFO
    if _RUNTIME_USER_INFO is None:
        _RUNTIME_USER_INFO = pwd.getpwnam(RUNTIME_USER)
    return _RUNTIME_USER_INFO


def runtime_subprocess_kwargs():
    if os.geteuid() != 0:
        return {}
    user = runtime_user_info()
    return {"user": user.pw_uid, "group": user.pw_gid, "extra_groups": []}


def runtime_chown(path: Path):
    if os.geteuid() != 0 or not path.exists():
        return
    user = runtime_user_info()
    targets = [path]
    if path.is_dir():
        targets.extend(path.rglob("*"))
    for target in targets:
        try:
            os.chown(target, user.pw_uid, user.pw_gid)
        except FileNotFoundError:
            pass


def read_json_file(path: Path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def write_json_file(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def write_claude_bootstrap(config_dir: Path, home_dir: Path, cwd: Path, base_url: str) -> Path:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    helper = config_dir / "codeagent-api-key-helper.sh"
    helper.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"${CODEAGENT_ANTHROPIC_API_KEY:-mock-key}\"\n",
        encoding="utf-8",
    )
    helper.chmod(0o700)

    settings = {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "apiKeyHelper": str(helper),
        "defaultMode": "acceptEdits",
        "skipDangerousModePermissionPrompt": True,
        "theme": "dark",
        "themeName": "dark",
        "themeSetting": "dark",
        "disableArtifact": True,
        "disableRemoteControl": True,
        "env": {
            "ANTHROPIC_BASE_URL": base_url,
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL": "1",
            "DISABLE_AUTOUPDATER": "1",
        },
    }
    settings_path = config_dir / "settings.json"
    write_json_file(settings_path, settings)
    write_json_file(home_dir / ".claude" / "settings.json", settings)

    for state_path in [config_dir / ".claude.json", home_dir / ".claude.json"]:
        state = read_json_file(state_path)
        state.setdefault("firstStartTime", now)
        state.setdefault("machineID", hashlib.sha256(str(config_dir).encode()).hexdigest())
        state.setdefault("seenNotifications", {})
        state.setdefault("migrationVersion", 13)
        state["hasCompletedOnboarding"] = True
        state["lastOnboardingVersion"] = CLAUDE_VERSION
        state["theme"] = "dark"
        state["themeName"] = "dark"
        state["themeSetting"] = "dark"
        projects = state.setdefault("projects", {})
        project = projects.setdefault(str(cwd), {})
        project["hasTrustDialogAccepted"] = True
        project["hasCompletedProjectOnboarding"] = True
        project["projectOnboardingSeenCount"] = 1
        write_json_file(state_path, state)

    return settings_path


def toml_string(value: str) -> str:
    return json.dumps(value)


def codex_base_url(base_url: str) -> str:
    raw = (base_url or CODEX_BASE_URL).strip().rstrip("/")
    if raw.endswith("/v1"):
        return raw
    return f"{raw}/v1"


def write_codex_bootstrap(home_dir: Path, cwd: Path, model: str, base_url: str) -> Path:
    config_dir = home_dir / ".codex"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "config.toml"
    provider = safe_name(CODEX_PROVIDER)
    config_path.write_text(
        f"model = {toml_string(model)}\n"
        f"model_provider = {toml_string(provider)}\n"
        'approval_policy = "on-failure"\n'
        'sandbox_mode = "workspace-write"\n'
        f"[model_providers.{provider}]\n"
        f"name = {toml_string(provider)}\n"
        f"base_url = {toml_string(codex_base_url(base_url))}\n"
        'env_key = "OPENAI_API_KEY"\n'
        'wire_api = "responses"\n'
        "\n"
        f"[projects.{toml_string(str(cwd))}]\n"
        'trust_level = "trusted"\n',
        encoding="utf-8",
    )
    return config_path


def run_tmux(args):
    return subprocess.run(
        ["tmux", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        **runtime_subprocess_kwargs(),
    )


def configure_tmux_session(name: str):
    options = [
        ["set-option", "-t", name, "mouse", "off"],
        ["set-option", "-t", name, "status", "off"],
        ["set-option", "-t", name, "focus-events", "on"],
        ["set-option", "-t", name, "history-limit", "50000"],
        ["set-window-option", "-t", f"{name}:0", "mode-keys", "vi"],
    ]
    for args in options:
        run_tmux(args)


def reset_tmux_interaction_state(name: str):
    run_tmux(["set-option", "-t", name, "mouse", "off"])
    run_tmux(["set-option", "-t", name, "status", "off"])
    run_tmux(["send-keys", "-t", name, "-X", "cancel"])


def install_claude_launcher(home_dir: Path, claude_bin: Path):
    bin_dir = home_dir / ".local" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    launcher = bin_dir / "claude"
    launcher.write_text(
        "#!/bin/sh\n"
        f"exec {shlex.quote(str(claude_bin))} \"$@\"\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)


def claude_process_env(home_dir: Path, config_dir: Path, base_url: str):
    blocked = {
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
        "CLAUDE_CODE_OAUTH_TOKEN",
    }
    env = {key: value for key, value in os.environ.items() if key not in blocked}
    env.update({
        "HOME": str(home_dir),
        "CLAUDE_CONFIG_DIR": str(config_dir),
        "CODEAGENT_ANTHROPIC_API_KEY": "mock-key",
        "ANTHROPIC_BASE_URL": base_url,
        "PATH": f"{home_dir / '.local' / 'bin'}:{env.get('PATH', '')}",
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "DISABLE_AUTOUPDATER": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    })
    return env


def codex_process_env(home_dir: Path, openai_api_key: str):
    blocked = {
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
        "CLAUDE_CODE_OAUTH_TOKEN",
    }
    env = {key: value for key, value in os.environ.items() if key not in blocked}
    env.update({
        "HOME": str(home_dir),
        "CODEX_HOME": str(home_dir / ".codex"),
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
    })
    if openai_api_key:
        env["OPENAI_API_KEY"] = openai_api_key
    return env


def ensure_claude_binary() -> Path:
    with CLAUDE_LOCK:
        if CLAUDE_BIN.exists() and os.access(CLAUDE_BIN, os.X_OK):
            return CLAUDE_BIN

        chunks = sorted(CLAUDE_CHUNK_DIR.glob("claude.part.*"))
        if not chunks:
            raise FileNotFoundError(f"Claude Code chunks not found in {CLAUDE_CHUNK_DIR}")

        CLAUDE_BIN.parent.mkdir(parents=True, exist_ok=True)
        tmp = CLAUDE_BIN.with_suffix(".tmp")
        with tmp.open("wb") as output:
            for chunk in chunks:
                output.write(chunk.read_bytes())
        tmp.chmod(0o755)
        tmp.replace(CLAUDE_BIN)
        return CLAUDE_BIN


def ensure_codex_binary() -> Path:
    candidate = shutil.which("codex")
    if candidate:
        return Path(candidate)
    if CODEX_BIN.exists() and os.access(CODEX_BIN, os.X_OK):
        return CODEX_BIN
    raise FileNotFoundError("Codex CLI not found")


def tmux_exists(session_id: str, agent: str = "claude") -> bool:
    return run_tmux(["has-session", "-t", session_name(session_id, agent)]).returncode == 0


def kill_tmux(session_id: str, agent: Optional[str] = None):
    agents = [safe_agent(agent)] if agent else sorted(AGENTS)
    for item in agents:
        name = session_name(session_id, item)
        if run_tmux(["has-session", "-t", name]).returncode == 0:
            run_tmux(["kill-session", "-t", name])


def resize_tmux_window(session_id: str, rows: int, cols: int, agent: str = "claude"):
    name = session_name(session_id, agent)
    if run_tmux(["has-session", "-t", name]).returncode != 0:
        return
    run_tmux(["resize-window", "-t", f"{name}:0", "-x", str(cols), "-y", str(rows)])


def maybe_accept_claude_trust_prompt(name: str):
    def worker():
        for _ in range(40):
            if run_tmux(["has-session", "-t", name]).returncode != 0:
                return
            pane = run_tmux(["capture-pane", "-p", "-t", name, "-S", "-200"])
            text = pane.stdout.lower()
            if "quick safety check" in text or "trust this folder" in text:
                run_tmux(["send-keys", "-t", name, "1", "Enter"])
                return
            if "write tests for @filename" in text or "claude exited" in text:
                return
            threading.Event().wait(0.5)

    threading.Thread(target=worker, daemon=True).start()


def ensure_claude_tmux(session_id: str, base_url: str, model: str):
    name = session_name(session_id, "claude")
    cwd = session_path(session_id)
    cwd.mkdir(parents=True, exist_ok=True)
    (cwd / ".codeagent").mkdir(exist_ok=True)
    runtime_chown(cwd)

    if tmux_exists(session_id, "claude"):
        return name, cwd

    config_dir = Path("/tmp/claude-config") / safe_name(session_id)
    home_dir = Path("/tmp/claude-home") / safe_name(session_id)
    config_dir.mkdir(parents=True, exist_ok=True)
    home_dir.mkdir(parents=True, exist_ok=True)
    settings_path = write_claude_bootstrap(config_dir, home_dir, cwd, base_url)
    claude_bin = ensure_claude_binary()
    install_claude_launcher(home_dir, claude_bin)
    runtime_chown(config_dir)
    runtime_chown(home_dir)

    model = safe_model(model)
    inner_command = (
        "printf '[starting claude]\\n'; "
        f"{shlex.quote(str(claude_bin))} --settings {shlex.quote(str(settings_path))}"
        f"{f' --model {shlex.quote(model)}' if model else ''} --permission-mode acceptEdits; "
        "code=$?; printf '\\n[claude exited: %s]\\n' \"$code\"; exec /bin/sh"
    )
    command = f"/bin/sh -lc {shlex.quote(inner_command)}"
    created = subprocess.run([
        "tmux", "new-session", "-d", "-s", name, "-c", str(cwd), command
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=claude_process_env(home_dir, config_dir, base_url), **runtime_subprocess_kwargs())
    if created.returncode != 0:
        raise RuntimeError(created.stderr or "failed to create claude tmux session")
    configure_tmux_session(name)
    maybe_accept_claude_trust_prompt(name)
    return name, cwd


def ensure_codex_tmux(session_id: str, openai_api_key: str, model: str, base_url: str):
    name = session_name(session_id, "codex")
    cwd = session_path(session_id)
    cwd.mkdir(parents=True, exist_ok=True)
    (cwd / ".codeagent").mkdir(exist_ok=True)
    runtime_chown(cwd)

    if tmux_exists(session_id, "codex"):
        return name, cwd

    model = safe_model(model, CODEX_MODEL)
    home_dir = Path("/tmp/codex-home") / safe_name(session_id)
    home_dir.mkdir(parents=True, exist_ok=True)
    write_codex_bootstrap(home_dir, cwd, model, base_url)
    codex_bin = ensure_codex_binary()
    runtime_chown(home_dir)

    if not openai_api_key:
        inner_command = (
            "printf '[starting codex]\\n'; "
            "printf 'Missing OPENAI_API_KEY. Configure the runtime Worker secret before starting Codex CLI sessions.\\n'; "
            "exec /bin/sh"
        )
    else:
        inner_command = (
            "printf '[starting codex]\\n'; "
            f"{shlex.quote(str(codex_bin))} --full-auto --model {shlex.quote(model)} -C {shlex.quote(str(cwd))}; "
            "code=$?; printf '\\n[codex exited: %s]\\n' \"$code\"; exec /bin/sh"
        )
    command = f"/bin/sh -lc {shlex.quote(inner_command)}"
    created = subprocess.run([
        "tmux", "new-session", "-d", "-s", name, "-c", str(cwd), command
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=codex_process_env(home_dir, openai_api_key), **runtime_subprocess_kwargs())
    if created.returncode != 0:
        raise RuntimeError(created.stderr or "failed to create codex tmux session")
    configure_tmux_session(name)
    return name, cwd


def ensure_agent_tmux(session_id: str, base_url: str, agent: str, openai_api_key: str, model: str):
    if safe_agent(agent) == "codex":
        return ensure_codex_tmux(session_id, openai_api_key, model, base_url)
    return ensure_claude_tmux(session_id, base_url, model)


def archive_path_is_excluded(relative: PurePosixPath) -> bool:
    parts = relative.parts
    if any(part in ARCHIVE_EXCLUDED_DIR_NAMES for part in parts):
        return True
    return any(parts[: len(prefix)] == prefix for prefix in ARCHIVE_EXCLUDED_PATHS)


def snapshot_workspace(root: Path, stage: str = "workspace.scan"):
    entries = []
    skipped = []
    if not root.exists():
        return entries, skipped

    def handle_walk_error(error):
        raise RuntimeOperationError(
            "workspace_scan_failed",
            stage,
            f"Failed to scan workspace: {error}",
            details={"path": str(Path(error.filename).name) if error.filename else ""},
        )

    for current, dir_names, file_names in os.walk(
        root, followlinks=False, onerror=handle_walk_error
    ):
        current_path = Path(current)
        kept_dirs = []
        for name in sorted(dir_names):
            path = current_path / name
            relative = PurePosixPath(path.relative_to(root).as_posix())
            if path.is_symlink() or archive_path_is_excluded(relative):
                skipped.append(relative.as_posix())
                continue
            kept_dirs.append(name)
        dir_names[:] = kept_dirs

        for name in sorted(file_names):
            path = current_path / name
            relative = PurePosixPath(path.relative_to(root).as_posix())
            if path.is_symlink() or archive_path_is_excluded(relative):
                skipped.append(relative.as_posix())
                continue
            try:
                stat_result = path.stat()
                data = path.read_bytes()
            except FileNotFoundError:
                skipped.append(relative.as_posix())
                continue
            except OSError as error:
                raise RuntimeOperationError(
                    "workspace_file_read_failed",
                    stage,
                    f"Failed to read workspace file: {relative.as_posix()}",
                    details={"path": relative.as_posix(), "reason": str(error)},
                ) from error
            entries.append({
                "path": relative.as_posix(),
                "data": data,
                "mode": stat_result.st_mode & 0o777,
                "mtime": int(stat_result.st_mtime),
            })

    entries.sort(key=lambda entry: entry["path"])
    return entries, skipped


def manifest_from_entries(session_id: str, entries, skipped=None):
    files = []
    digest = hashlib.sha256()
    for entry in entries:
        file_sha = sha256_bytes(entry["data"])
        digest.update(entry["path"].encode())
        digest.update(b"\0")
        digest.update(file_sha.encode())
        digest.update(b"\0")
        files.append({
            "path": entry["path"],
            "size": len(entry["data"]),
            "sha256": file_sha,
        })

    skipped = skipped or []
    return {
        "ok": True,
        "session": session_id,
        "exists": True,
        "digest": digest.hexdigest(),
        "file_count": len(files),
        "files": files,
        "skipped_count": len(skipped),
        "skipped_files": skipped[:50],
    }


def workspace_manifest_for_root(session_id: str, root: Path):
    if not root.exists():
        return {
            "ok": True,
            "session": session_id,
            "exists": False,
            "digest": None,
            "file_count": 0,
            "files": [],
            "skipped_count": 0,
            "skipped_files": [],
        }
    entries, skipped = snapshot_workspace(root, "workspace.inspect")
    return manifest_from_entries(session_id, entries, skipped)


def workspace_manifest(session_id: str):
    return workspace_manifest_for_root(session_id, session_path(session_id))


def seed_workspace(session_id: str):
    root = session_path(session_id)
    if root.exists():
        shutil.rmtree(root)
    (root / "dist" / "assets").mkdir(parents=True, exist_ok=True)
    (root / "README.md").write_text(f"# Integrated session\n\nsession={session_id}\n", encoding="utf-8")
    (root / "dist" / "index.html").write_text("""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Integrated Preview</title>
    <link rel="stylesheet" href="./assets/style.css" />
  </head>
  <body>
    <main>
      <p class="eyebrow">Integrated Session MVP</p>
      <h1>Preview from restored workspace</h1>
      <p id="session">loading</p>
    </main>
    <script src="./assets/app.js"></script>
  </body>
</html>
""", encoding="utf-8")
    (root / "dist" / "assets" / "style.css").write_text("""
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f8fafc; color: #111827; }
main { width: min(680px, calc(100vw - 32px)); padding: 32px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
.eyebrow { color: #2563eb; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 8px 0 12px; font-size: 32px; }
#session { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
""", encoding="utf-8")
    (root / "dist" / "assets" / "app.js").write_text("""
fetch("./api/session")
  .then((response) => response.json())
  .then((data) => {
    document.querySelector("#session").textContent = `user=${data.userId} session=${data.sessionId} runtime=${data.runtime}`;
    });
""", encoding="utf-8")
    runtime_chown(root)
    return workspace_manifest(session_id)


def make_archive(session_id: str):
    root = session_path(session_id)
    if not root.exists():
        raise RuntimeOperationError(
            "workspace_not_found",
            "archive.snapshot",
            f"Workspace not found: {session_id}",
            404,
        )
    entries, skipped = snapshot_workspace(root, "archive.snapshot")
    manifest = manifest_from_entries(session_id, entries, skipped)
    buf = io.BytesIO()
    try:
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for entry in entries:
                info = tarfile.TarInfo(entry["path"])
                info.size = len(entry["data"])
                info.mode = entry["mode"]
                info.mtime = entry["mtime"]
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                tar.addfile(info, io.BytesIO(entry["data"]))
    except Exception as error:
        raise RuntimeOperationError(
            "archive_build_failed",
            "archive.build",
            f"Failed to build workspace archive: {error}",
        ) from error
    return buf.getvalue(), manifest


def safe_archive_member_path(member_name: str) -> PurePosixPath:
    relative = PurePosixPath(member_name)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise RuntimeOperationError(
            "unsafe_archive_path",
            "restore.validate",
            f"Unsafe archive path: {member_name}",
            422,
            {"path": member_name},
        )
    return relative


def restore_archive(
    session_id: str,
    data: bytes,
    expected_workspace_digest: str = "",
    expected_archive_sha256: str = "",
    archive_format: str = "1",
):
    root = session_path(session_id)
    staging = ROOT / f".{safe_name(session_id)}.restore-{uuid.uuid4().hex}"
    backup = ROOT / f".{safe_name(session_id)}.backup-{uuid.uuid4().hex}"

    actual_archive_sha256 = sha256_bytes(data)
    if expected_archive_sha256 and actual_archive_sha256 != expected_archive_sha256:
        raise RuntimeOperationError(
            "archive_checksum_mismatch",
            "restore.validate",
            "Archive checksum does not match R2 metadata",
            409,
            {
                "expectedArchiveSha256": expected_archive_sha256,
                "actualArchiveSha256": actual_archive_sha256,
            },
        )

    try:
        staging.mkdir(parents=True, exist_ok=False)
        try:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                for member in tar.getmembers():
                    relative = safe_archive_member_path(member.name)
                    if member.isdir():
                        (staging.joinpath(*relative.parts)).mkdir(
                            parents=True, exist_ok=True
                        )
                        continue
                    if not member.isfile():
                        raise RuntimeOperationError(
                            "unsupported_archive_entry",
                            "restore.validate",
                            f"Unsupported archive entry: {member.name}",
                            422,
                            {
                                "path": member.name,
                                "type": member.type.decode(errors="ignore"),
                            },
                        )
                    source = tar.extractfile(member)
                    if source is None:
                        raise RuntimeOperationError(
                            "archive_entry_unreadable",
                            "restore.extract",
                            f"Archive entry cannot be read: {member.name}",
                            422,
                            {"path": member.name},
                        )
                    target = staging.joinpath(*relative.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(member.mode & 0o777)
        except RuntimeOperationError:
            raise
        except (tarfile.TarError, OSError) as error:
            raise RuntimeOperationError(
                "archive_extract_failed",
                "restore.extract",
                f"Failed to extract workspace archive: {error}",
                422,
            ) from error

        manifest = workspace_manifest_for_root(session_id, staging)
        actual_workspace_digest = manifest.get("digest") or ""
        if (
            archive_format == ARCHIVE_FORMAT
            and expected_workspace_digest
            and actual_workspace_digest != expected_workspace_digest
        ):
            raise RuntimeOperationError(
                "workspace_digest_mismatch",
                "restore.verify",
                "Extracted workspace digest does not match archive metadata",
                409,
                {
                    "expectedWorkspaceDigest": expected_workspace_digest,
                    "actualWorkspaceDigest": actual_workspace_digest,
                },
            )

        runtime_chown(staging)
        try:
            if root.exists():
                root.rename(backup)
            staging.rename(root)
        except Exception as error:
            if not root.exists() and backup.exists():
                backup.rename(root)
            raise RuntimeOperationError(
                "workspace_swap_failed",
                "restore.swap",
                f"Failed to activate restored workspace: {error}",
            ) from error

        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
        return {
            **manifest,
            "workspace": str(root),
            "archive_format": archive_format,
            "archive_sha256": actual_archive_sha256,
        }
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def serve_file(handler, path: Path):
    content_types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }
    if not path.exists() or path.is_dir():
        handler.send_response(404)
        handler.end_headers()
        return
    data = path.read_bytes()
    handler.send_response(200)
    handler.send_header("content-type", content_types.get(path.suffix, "application/octet-stream"))
    handler.send_header("content-length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.split("/") if part]
        try:
            if parsed.path == "/health":
                claude_bin = ensure_claude_binary()
                try:
                    codex_bin = ensure_codex_binary()
                    codex_version = subprocess.check_output([str(codex_bin), "--version"], text=True).strip()
                    codex_binary = str(codex_bin)
                except Exception as error:
                    codex_version = f"unavailable: {error}"
                    codex_binary = ""
                write_json(self, 200, {
                    "ok": True,
                    "runtime": "integrated-session-mvp",
                    "agent": safe_agent(self.headers.get("x-codeagent-agent")),
                    "model": safe_model(self.headers.get("x-codeagent-model")),
                    "tmux": subprocess.check_output(["tmux", "-V"], text=True).strip(),
                    "claude": subprocess.check_output([str(claude_bin), "--version"], text=True).strip(),
                    "claudeBinary": str(claude_bin),
                    "claudeChunks": len(list(CLAUDE_CHUNK_DIR.glob("claude.part.*"))),
                    "codex": codex_version,
                    "codexBinary": codex_binary,
                    "codexConfigured": bool(self.headers.get("x-codeagent-openai-api-key")),
                })
                return
            if len(parts) == 2 and parts[0] == "inspect":
                write_json(self, 200, workspace_manifest(parts[1]))
                return
            if len(parts) == 2 and parts[0] == "tmux":
                query = parse_qs(parsed.query)
                agent = safe_agent(query.get("agent", ["claude"])[0])
                model = safe_model(query.get("model", [""])[0])
                write_json(self, 200, {
                    "ok": True,
                    "session": parts[1],
                    "agent": agent,
                    "model": model,
                    "tmuxSession": session_name(parts[1], agent),
                    "exists": tmux_exists(parts[1], agent),
                })
                return
            if len(parts) == 2 and parts[0] == "archive":
                data, manifest = make_archive(parts[1])
                self.send_response(200)
                self.send_header("content-type", "application/gzip")
                self.send_header("content-length", str(len(data)))
                self.send_header("x-archive-sha256", sha256_bytes(data))
                self.send_header("x-workspace-digest", manifest["digest"])
                self.send_header("x-file-count", str(manifest["file_count"]))
                self.send_header(
                    "x-skipped-file-count", str(manifest["skipped_count"])
                )
                self.send_header("x-archive-format", ARCHIVE_FORMAT)
                self.end_headers()
                self.wfile.write(data)
                return
            if len(parts) >= 2 and parts[0] == "preview":
                session_id = parts[1]
                rest = parts[2:]
                if len(rest) == 0:
                    file_path = session_path(session_id) / "dist" / "index.html"
                elif rest == ["api", "session"]:
                    user_id = self.headers.get("x-codeagent-user", "unknown-user")
                    write_json(self, 200, {
                        "ok": True,
                        "userId": user_id,
                        "sessionId": session_id,
                        "runtime": "integrated-session-mvp",
                    })
                    return
                else:
                    file_path = session_path(session_id) / "dist" / Path(*rest)
                serve_file(self, file_path)
                return
            write_json(self, 404, {"ok": False, "error": "not_found", "path": parsed.path})
        except Exception as error:
            write_runtime_error(self, error, "request.get")

    def do_POST(self):
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.split("/") if part]
        try:
            if len(parts) == 2 and parts[0] == "seed":
                write_json(self, 200, seed_workspace(parts[1]))
                return
            if len(parts) == 2 and parts[0] == "clear":
                agent = safe_agent(parse_qs(parsed.query).get("agent", ["claude"])[0])
                kill_tmux(parts[1], agent)
                root = session_path(parts[1])
                if root.exists():
                    shutil.rmtree(root)
                write_json(self, 200, workspace_manifest(parts[1]))
                return
            write_json(self, 404, {"ok": False, "error": "not_found", "path": parsed.path})
        except Exception as error:
            write_runtime_error(self, error, "request.post")

    def do_PUT(self):
        parsed = urlparse(self.path)
        parts = [unquote(part) for part in parsed.path.split("/") if part]
        if len(parts) != 2 or parts[0] != "restore":
            write_json(self, 404, {"ok": False, "error": "not_found", "path": parsed.path})
            return
        length = int(self.headers.get("content-length", "0"))
        try:
            active_agents = sorted(
                agent for agent in AGENTS if tmux_exists(parts[1], agent)
            )
            if active_agents:
                raise RuntimeOperationError(
                    "active_workspace_restore_blocked",
                    "restore.guard",
                    "Restore blocked because the workspace has an active terminal session",
                    409,
                    {"activeAgents": active_agents},
                )
            write_json(
                self,
                200,
                restore_archive(
                    parts[1],
                    self.rfile.read(length),
                    self.headers.get("x-expected-workspace-digest", ""),
                    self.headers.get("x-expected-archive-sha256", ""),
                    self.headers.get("x-archive-format", "1"),
                ),
            )
        except Exception as error:
            write_runtime_error(self, error, "restore.request")

    def setup(self):
        super().setup()
        self.request.settimeout(None)

    def handle(self):
        data = self.request.recv(65536, socket.MSG_PEEK)
        if b"Upgrade: websocket" not in data and b"upgrade: websocket" not in data:
            return super().handle()
        request = self.request.recv(65536).decode("utf-8", errors="ignore")
        lines = request.split("\r\n")
        path = lines[0].split(" ")[1]
        parsed = urlparse(path)
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.lower()] = value.strip()
        if not parsed.path.startswith("/terminal/"):
            self.request.close()
            return
        key = headers.get("sec-websocket-key", "")
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.request.sendall((
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        ).encode())
        query = parse_qs(parsed.query)
        agent = safe_agent(query.get("agent", [headers.get("x-codeagent-agent", "claude")])[0])
        model = safe_model(query.get("model", [headers.get("x-codeagent-model", "")])[0])
        self.serve_terminal(
            unquote(parsed.path.removeprefix("/terminal/")),
            query.get("base_url", [""])[0],
            agent,
            model,
            headers.get("x-codeagent-openai-api-key", ""),
        )

    def serve_terminal(self, session_id: str, base_url: str, agent: str, model: str, openai_api_key: str):
        if not base_url:
            self.request.sendall(encode_frame(b"Missing base_url\r\n"))
            self.request.close()
            return
        agent = safe_agent(agent)
        tmux_name, _ = ensure_agent_tmux(session_id, base_url, agent, openai_api_key, model)
        reset_tmux_interaction_state(tmux_name)
        master_fd, slave_fd = pty.openpty()
        rows, cols = terminal_size(DEFAULT_TERMINAL_ROWS, DEFAULT_TERMINAL_COLS)
        set_winsize(master_fd, rows, cols)
        resize_tmux_window(session_id, rows, cols, agent)
        client = subprocess.Popen(
            ["tmux", "attach-session", "-t", tmux_name],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env={**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"},
            start_new_session=True,
            **runtime_subprocess_kwargs(),
        )
        os.close(slave_fd)
        self.request.sendall(encode_frame(f"Connected to integrated tmux session ({agent}): {tmux_name}\r\n".encode()))
        stop = threading.Event()

        def pump_pty():
            while not stop.is_set():
                readable, _, _ = select.select([master_fd], [], [], 0.1)
                if master_fd in readable:
                    try:
                        chunk = os.read(master_fd, 4096)
                    except OSError:
                        break
                    if not chunk:
                        break
                    self.request.sendall(encode_frame(chunk))

        threading.Thread(target=pump_pty, daemon=True).start()
        try:
            while True:
                message = decode_frame(self.request)
                if message is None:
                    break
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "input":
                    os.write(master_fd, payload.get("data", "").encode())
                elif payload.get("type") == "resize":
                    rows, cols = terminal_size(payload.get("rows"), payload.get("cols"))
                    set_winsize(master_fd, rows, cols)
                    resize_tmux_window(session_id, rows, cols, agent)
        finally:
            stop.set()
            try:
                os.killpg(os.getpgid(client.pid), signal.SIGTERM)
            except Exception:
                pass
            try:
                os.close(master_fd)
            except Exception:
                pass


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", "8080"))
    with ThreadingServer(("0.0.0.0", port), Handler) as server:
        print(f"integrated session container listening on {port}", flush=True)
        server.serve_forever()
