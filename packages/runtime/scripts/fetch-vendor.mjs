import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(runtimeRoot, 'container', 'vendor');
const packages = [
  '@anthropic-ai/claude-code-linux-x64@2.1.197',
  '@anthropic-ai/claude-code-linux-arm64@2.1.197',
  '@openai/codex@0.39.0',
];

mkdirSync(vendorDir, { recursive: true });

for (const packageSpec of packages) {
  const result = spawnSync(
    'npm',
    ['pack', packageSpec, '--pack-destination', vendorDir],
    {
      cwd: runtimeRoot,
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
