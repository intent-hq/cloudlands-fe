import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Instruction files (AGENTS.md) must not pin a literal `@augmentcode/themis@<version>`.
// src/store/renderer/AGENTS.md carried `@augmentcode/themis@0.1.1` while package.json
// had moved on to 0.2.x; the drift was flagged in review of cloudlands-fe#2310. The
// version declared in package.json is the only source of truth, so any literal pin in
// an AGENTS.md is a violation regardless of whether it currently matches.
export const INSTRUCTION_FILE_NAME = 'AGENTS.md';
export const REMEDIATION_HINT =
  'Remove the literal pin and refer to "the `@augmentcode/themis` version declared in `package.json`" instead.';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git']);

// A pin is the package name immediately followed by `@` and a non-empty specifier.
// A bare `@augmentcode/themis` or a subpath import such as
// `@augmentcode/themis/utils/...` does not match.
const PIN_PATTERN = /@augmentcode\/themis@[^\s`'"<>)\]]+/g;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export function findInstructionThemisPinViolations(files) {
  const violations = [];
  for (const file of files) {
    const filePath = normalize(file.path);
    if (path.posix.basename(filePath) !== INSTRUCTION_FILE_NAME) continue;
    const lines = file.content.split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(PIN_PATTERN)) {
        violations.push({ path: filePath, line: index + 1, match: match[0] });
      }
    });
  }
  return violations;
}

function collectInstructionFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...collectInstructionFiles(absolute));
    } else if (entry.name === INSTRUCTION_FILE_NAME) {
      files.push({
        path: normalize(path.relative(process.cwd(), absolute)),
        content: fs.readFileSync(absolute, 'utf8'),
      });
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = collectInstructionFiles(process.cwd());
  const violations = findInstructionThemisPinViolations(files);
  if (violations.length) {
    console.error(
      [
        'Literal Themis version pins in instruction files:',
        ...violations.map(({ path: filePath, line, match }) => `${filePath}:${line}: ${match}`),
        REMEDIATION_HINT,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(
    `Instruction Themis pins valid: ${files.length} ${INSTRUCTION_FILE_NAME} files carry no literal @augmentcode/themis@<version> pin.`,
  );
}
