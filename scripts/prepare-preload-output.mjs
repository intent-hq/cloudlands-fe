import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function preparePreloadOutput(root = join(dirname(fileURLToPath(import.meta.url)), '..')) {
  const output = join(root, 'dist/preload-build');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'package.json'), '{"type":"commonjs"}\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePreloadOutput();
}
