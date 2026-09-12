import { execFileSync } from 'node:child_process';
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
// `**/` matches at every depth including the scan root itself.
const INSTRUCTION_PATHSPEC = `:(glob)**/${INSTRUCTION_FILE_NAME}`;

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

const readInstructionFile = (root, relativePath) => ({
  path: normalize(relativePath),
  content: fs.readFileSync(path.join(root, relativePath), 'utf8'),
});

const isFile = (absolute) => {
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
};

// Tracked plus ordinary untracked instruction files, honoring the repository's
// ignore rules. Git lists a nested repository (checkout or worktree) as a bare
// directory entry and never descends into it, so ignored verification artifacts
// such as `.demo-artifacts/verify-*` and foreign checkouts stay out of the audit
// (intent-hq/intent#4808). The pathspec keeps the listing to instruction files
// only, so its size does not grow with the index; the stat filter drops tracked
// entries deleted from the working tree and directories that happen to carry the
// instruction file name. Returns null when `root` is not inside a Git repository.
function listRepositoryInstructionFiles(root) {
  let listing;
  try {
    listing = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', INSTRUCTION_PATHSPEC],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    if (error?.code === 'ENOENT' || /not a git repository/i.test(String(error?.stderr ?? ''))) {
      return null;
    }
    throw error;
  }
  const candidates = new Set(
    listing.split('\0').filter((entry) => entry && path.basename(entry) === INSTRUCTION_FILE_NAME),
  );
  return [...candidates]
    .filter((entry) => isFile(path.join(root, entry)))
    .map((entry) => readInstructionFile(root, entry));
}

function walkInstructionFiles(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...walkInstructionFiles(root, absolute));
    } else if (entry.name === INSTRUCTION_FILE_NAME) {
      files.push(readInstructionFile(root, path.relative(root, absolute)));
    }
  }
  return files;
}

function collectInstructionFiles(root) {
  return listRepositoryInstructionFiles(root) ?? walkInstructionFiles(root);
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
