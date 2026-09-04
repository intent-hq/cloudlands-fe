import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.env.DESIGN_TOKEN_AUDIT_SOURCE_ROOT
  ? path.resolve(process.env.DESIGN_TOKEN_AUDIT_SOURCE_ROOT)
  : path.join(root, 'src');
const allowlist = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/design-token-allowlist.json'), 'utf8'),
);
const tokenSource = fs.readFileSync(path.join(root, 'src/lib/styles/tokens.css'), 'utf8');
const approved = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'muted',
  'muted-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
];
const extensions = new Set(['.css', '.svelte', '.ts']);
const files = [];

function walk(directory) {
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (extensions.has(path.extname(entry.name))) files.push(target);
  }
}

walk(sourceRoot);
const definitions = new Set();
const usages = new Map();
const rawByFile = new Map();
const palettePattern =
  /(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[1-9]50|[1-9]00)\b/g;
const arbitraryPattern =
  /(?:bg|text|border|ring|fill|stroke|shadow|rounded|w|h|min-w|min-h|max-w|max-h|p[trblxy]?|m[trblxy]?|gap)-\[[^\]\r\n]+\]/g;

function withoutNegativeAssertions(source) {
  return source.replace(
    /\.not\.(?:toContain|toEqual|toMatch)\(\s*(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*\1\s*\)/g,
    '',
  );
}

for (const file of files) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) definitions.add(match[1]);
  for (const match of source.matchAll(/\.setProperty\(\s*(['"])(--[A-Za-z0-9_-]+)\1\s*,/g)) {
    definitions.add(match[2]);
  }
  for (const match of withoutNegativeAssertions(source).matchAll(/var\((--[A-Za-z0-9_-]+)/g)) {
    if (!usages.has(match[1])) usages.set(match[1], new Set());
    usages.get(match[1]).add(relative);
  }
  const paletteUtilities = [
    ...new Set([...source.matchAll(palettePattern)].map(([match]) => match)),
  ];
  const arbitraryUtilities = [
    ...new Set([...source.matchAll(arbitraryPattern)].map(([match]) => match)),
  ];
  const palette = [...source.matchAll(palettePattern)].length;
  const arbitrary = [...source.matchAll(arbitraryPattern)].length;
  if (palette || arbitrary) {
    rawByFile.set(relative, { palette, arbitrary, paletteUtilities, arbitraryUtilities });
  }
}

const runtimePatterns = [
  /^--color-(?:white|black)$/,
  /^--color-[a-z]+-[0-9]{2,3}$/,
  /^--radix-/,
  /^--bits-popover-content-available-(height|width)$/,
  // Set by bits-ui at runtime on Select content; externally owned, not a design token.
  /^--bits-select-content-available-height$/,
  // Set by bits-ui at runtime on menu content (dropdown-menu content and the shared
  // menu primitive used by SubContent); externally owned, not design tokens.
  /^--bits-(?:dropdown-)?menu-content-available-height$/,
];
const exceptionFiles = new Map(
  allowlist.undefined.map((entry) => [entry.token, new Set(entry.allowedFiles ?? [])]),
);
const unknown = [...usages.entries()]
  .filter(([token]) => !definitions.has(token))
  .filter(([token]) => !runtimePatterns.some((pattern) => pattern.test(token)))
  .flatMap(([token, paths]) =>
    [...paths]
      .filter((file) => !exceptionFiles.get(token)?.has(file))
      .map((file) => ({ token, file })),
  )
  .sort((a, b) => a.token.localeCompare(b.token) || a.file.localeCompare(b.file));
const totals = [...rawByFile.values()].reduce(
  (sum, value) => ({
    palette: sum.palette + value.palette,
    arbitrary: sum.arbitrary + value.arbitrary,
  }),
  { palette: 0, arbitrary: 0 },
);
const mode = process.argv[2] ?? 'check';

if (mode === 'approved') {
  console.log(approved.map((token) => `--${token}`).join('\n'));
} else if (mode === 'aliases') {
  console.log(
    allowlist.aliases
      .map((entry) => {
        const paths = [...(usages.get(entry.token) ?? [])].filter(
          (file) => file !== 'src/lib/styles/tokens.css',
        );
        return `${entry.token}\t${entry.owner}\t${entry.replacement}\t${paths.join(',') || '-'}`;
      })
      .join('\n'),
  );
} else if (mode === 'raw') {
  console.log(`palette\t${totals.palette}`);
  console.log(`arbitrary\t${totals.arbitrary}`);
  for (const [file, counts] of [...rawByFile].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${file}\t${counts.palette}\t${counts.arbitrary}`);
  }
} else if (mode === 'undefined') {
  console.log(
    unknown.map(({ token, file }) => `${token}\t${file}\tuse an approved semantic role`).join('\n'),
  );
} else if (mode === 'check') {
  const failures = unknown.map(
    ({ token, file }) => `${file}: unknown ${token}; use an approved semantic role`,
  );
  for (const token of approved) {
    const count = [...tokenSource.matchAll(new RegExp(`(^|\\s)--${token}:`, 'gm'))].length;
    if (count !== 1)
      failures.push(
        `src/lib/styles/tokens.css: --${token} declarations=${count}; expected exactly 1`,
      );
  }
  for (const entry of allowlist.aliases) {
    const allowedFiles = new Set(entry.allowedFiles ?? []);
    for (const file of usages.get(entry.token) ?? []) {
      if (file !== 'src/lib/styles/tokens.css' && !allowedFiles.has(file)) {
        failures.push(`${file}: adapter-only ${entry.token}; use ${entry.replacement}`);
      }
    }
  }
  for (const [file, counts] of rawByFile) {
    if (!file.startsWith('src/lib/components/ui/')) continue;
    const ceiling = allowlist.canonicalRaw[file];
    const paletteBoundary = allowlist.physicalPaletteBoundaries.some(
      (entry) => entry.file === file,
    );
    if (!ceiling)
      failures.push(`${file}: raw utilities need an explicit canonical-library ceiling`);
    else if (counts.palette > ceiling.palette || counts.arbitrary > ceiling.arbitrary) {
      failures.push(
        `${file}: raw utilities grew; use approved semantic roles and Tailwind spacing`,
      );
    }
    if (counts.palette > 0 && !paletteBoundary) {
      failures.push(`${file}: physical palette utility; use an approved semantic color family`);
    }
  }
  if (totals.palette > allowlist.ratchets.palette) {
    for (const [file, counts] of rawByFile) {
      if (!counts.palette) continue;
      failures.push(
        `${file}: physical palette utilities ${counts.paletteUtilities.join(', ')}; use an approved semantic color family (global total ${totals.palette} > ${allowlist.ratchets.palette})`,
      );
    }
  }
  if (totals.arbitrary > allowlist.ratchets.arbitrary) {
    for (const [file, counts] of rawByFile) {
      if (!counts.arbitrary) continue;
      failures.push(
        `${file}: arbitrary utilities ${counts.arbitraryUtilities.join(', ')}; use approved semantic roles and Tailwind spacing (global total ${totals.arbitrary} > ${allowlist.ratchets.arbitrary})`,
      );
    }
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `token audit passed; palette=${totals.palette}; arbitrary=${totals.arbitrary}; unknown=0`,
    );
} else {
  console.error('usage: design-token-audit.mjs [approved|aliases|raw|undefined|check]');
  process.exitCode = 2;
}
