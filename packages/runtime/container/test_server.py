import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path


SERVER_PATH = Path(__file__).with_name("server.py")
SPEC = importlib.util.spec_from_file_location("hicode_runtime_server", SERVER_PATH)
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class WorkspaceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_root = server.ROOT
        server.ROOT = Path(self.temp_dir.name) / "sessions"
        server.ROOT.mkdir(parents=True)
        self.session_id = "session-test"
        self.root = server.session_path(self.session_id)
        self.root.mkdir(parents=True)

    def tearDown(self):
        server.ROOT = self.original_root
        self.temp_dir.cleanup()

    def write(self, relative: str, content: bytes):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def archive_entries(self, data: bytes):
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            return {
                member.name: archive.extractfile(member).read()
                for member in archive.getmembers()
                if member.isfile()
            }

    def test_archive_excludes_regenerable_dependencies(self):
        self.write("src/index.ts", b"export const value = 1;\n")
        self.write("node_modules/pkg/index.js", b"ignored\n")
        self.write(".next/cache/data.bin", b"ignored\n")

        data, manifest = server.make_archive(self.session_id)
        entries = self.archive_entries(data)

        self.assertEqual(set(entries), {"src/index.ts"})
        self.assertEqual(manifest["file_count"], 1)
        self.assertEqual(manifest["skipped_count"], 2)

    def test_manifest_digest_is_computed_from_archived_bytes(self):
        self.write("README.md", b"snapshot\n")
        self.write("src/main.js", b"console.log('snapshot');\n")

        data, manifest = server.make_archive(self.session_id)
        entries = self.archive_entries(data)
        digest = hashlib.sha256()
        for path, content in sorted(entries.items()):
            digest.update(path.encode())
            digest.update(b"\0")
            digest.update(hashlib.sha256(content).hexdigest().encode())
            digest.update(b"\0")

        self.assertEqual(manifest["digest"], digest.hexdigest())

    def test_successful_restore_replaces_workspace_after_validation(self):
        self.write("old.txt", b"old\n")
        replacement_root = Path(self.temp_dir.name) / "replacement"
        replacement_root.mkdir()
        (replacement_root / "new.txt").write_bytes(b"new\n")
        entries, skipped = server.snapshot_workspace(replacement_root)
        expected = server.manifest_from_entries(self.session_id, entries, skipped)
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as tar:
            info = tarfile.TarInfo("new.txt")
            info.size = 4
            tar.addfile(info, io.BytesIO(b"new\n"))
        data = archive.getvalue()

        restored = server.restore_archive(
            self.session_id,
            data,
            expected["digest"],
            server.sha256_bytes(data),
            server.ARCHIVE_FORMAT,
        )

        self.assertFalse((self.root / "old.txt").exists())
        self.assertEqual((self.root / "new.txt").read_bytes(), b"new\n")
        self.assertEqual(restored["digest"], expected["digest"])

    def test_digest_failure_preserves_existing_workspace(self):
        self.write("old.txt", b"keep me\n")
        data, _manifest = server.make_archive(self.session_id)

        with self.assertRaises(server.RuntimeOperationError) as raised:
            server.restore_archive(
                self.session_id,
                data,
                "not-the-real-digest",
                server.sha256_bytes(data),
                server.ARCHIVE_FORMAT,
            )

        self.assertEqual(raised.exception.stage, "restore.verify")
        self.assertEqual((self.root / "old.txt").read_bytes(), b"keep me\n")

    def test_unsafe_archive_preserves_existing_workspace(self):
        self.write("old.txt", b"keep me\n")
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as tar:
            info = tarfile.TarInfo("../escape.txt")
            info.size = 7
            tar.addfile(info, io.BytesIO(b"escape\n"))
        data = archive.getvalue()

        with self.assertRaises(server.RuntimeOperationError) as raised:
            server.restore_archive(
                self.session_id,
                data,
                expected_archive_sha256=server.sha256_bytes(data),
                archive_format=server.ARCHIVE_FORMAT,
            )

        self.assertEqual(raised.exception.code, "unsafe_archive_path")
        self.assertEqual((self.root / "old.txt").read_bytes(), b"keep me\n")
        self.assertFalse((server.ROOT.parent / "escape.txt").exists())


if __name__ == "__main__":
    unittest.main()
