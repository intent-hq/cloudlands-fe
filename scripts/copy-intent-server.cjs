/**
 * Cross-platform script to copy intent-server.cjs to dist.
 * Replaces Unix-only `mkdir -p` and `cp` in the build:main script.
 */
const fs = require('fs');
const path = require('path');

const destDir = path.join('dist', 'features', 'agent', 'main', 'remote-server');
const srcFile = path.join('src', 'features', 'agent', 'main', 'remote-server', 'intent-server.cjs');
const destFile = path.join(destDir, 'intent-server.cjs');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(srcFile, destFile);

