FROM python:3.12-slim AS claude-code
COPY vendor/anthropic-ai-claude-code-linux-*.tgz /tmp/vendor/
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64|amd64) package="anthropic-ai-claude-code-linux-x64-2.1.197.tgz" ;; \
      aarch64|arm64) package="anthropic-ai-claude-code-linux-arm64-2.1.197.tgz" ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/claude-code \
    && tar -xzf "/tmp/vendor/$package" -C /opt/claude-code --strip-components=1 package/claude \
    && chmod +x /opt/claude-code/claude \
    && /opt/claude-code/claude --version \
    && mkdir -p /opt/claude-code/chunks \
    && split -b 60m /opt/claude-code/claude /opt/claude-code/chunks/claude.part.

FROM node:20-slim

RUN apt-get -o Acquire::Retries=5 update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client python3 ripgrep tmux \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /workspace/sessions /tmp/claude-home /tmp/claude-config /tmp/codex-home /opt/claude-code/chunks \
  && useradd -m -u 10001 appuser \
  && chown -R appuser:appuser /workspace /tmp/claude-home /tmp/claude-config /tmp/codex-home \
  && python3 --version \
  && git --version \
  && ssh -V \
  && node --version \
  && npm --version \
  && tmux -V

COPY vendor/openai-codex-0.39.0.tgz /tmp/vendor/

RUN mkdir -p /opt/openai-codex \
  && tar -xzf /tmp/vendor/openai-codex-0.39.0.tgz -C /opt/openai-codex --strip-components=1 \
  && rm -rf /tmp/vendor \
  && chmod +x /opt/openai-codex/bin/codex.js /opt/openai-codex/bin/codex-* \
  && ln -s /opt/openai-codex/bin/codex.js /usr/local/bin/codex \
  && codex --version

COPY --from=claude-code /opt/claude-code/chunks/claude.part.aa /opt/claude-code/chunks/claude.part.aa
COPY --from=claude-code /opt/claude-code/chunks/claude.part.ab /opt/claude-code/chunks/claude.part.ab
COPY --from=claude-code /opt/claude-code/chunks/claude.part.ac /opt/claude-code/chunks/claude.part.ac
COPY --from=claude-code /opt/claude-code/chunks/claude.part.ad /opt/claude-code/chunks/claude.part.ad

WORKDIR /app
COPY server.py ./

EXPOSE 8080
USER appuser
CMD ["python3", "server.py"]
