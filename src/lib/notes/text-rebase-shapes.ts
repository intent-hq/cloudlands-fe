/**
 * The seeded note shapes of the text-rebase alignment bench: fixed markdown
 * corpora drawn from checked-in code, no fixture blobs, so a perf figure
 * names its shape and every machine draws the same bytes. Pure and
 * synchronous — the plain-text projection the alignment maps against is the
 * caller's to produce.
 */

export interface TextRebaseShape {
  name: string;
  markdown: string;
}

export const TEXT_REBASE_SHAPE_NAMES = [
  'formatted',
  'mixed',
  'link-heavy',
  'image-heavy',
  'table-heavy',
  'fenced-code-heavy',
  '150kib',
  '1mib',
] as const;

type ShapeName = (typeof TEXT_REBASE_SHAPE_NAMES)[number];

const KIB = 1024;
/** Below the alignment's 128 KiB lexing cap, so the themed shapes take its main path. */
const THEMED_MIN_LENGTH = 96 * KIB;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'alignment',
  'caret',
  'daemon',
  'editor',
  'markdown',
  'note',
  'offset',
  'peer',
  'presence',
  'projection',
  'render',
  'selection',
  'span',
  'sync',
  'text',
  'workspace',
];

const LANGUAGES = ['ts', 'rust', 'sh', 'json', 'py'];

interface Draw {
  rng: () => number;
  int: (max: number) => number;
  pick: () => string;
  words: (n: number) => string;
  sentence: (n: number) => string;
  url: () => string;
}

function draw(seed: number): Draw {
  const rng = mulberry32(seed);
  const int = (max: number) => Math.floor(rng() * max);
  const pick = () => WORDS[int(WORDS.length)];
  const words = (n: number) => Array.from({ length: n }, pick).join(' ');
  const sentence = (n: number) => {
    const s = words(n);
    return s[0].toUpperCase() + s.slice(1) + '.';
  };
  const url = () => `https://example.com/${pick()}/${pick()}-${pick()}`;
  return { rng, int, pick, words, sentence, url };
}

const heading = (d: Draw, level: number) => `${'#'.repeat(level)} ${d.words(3)}`;
const plain = (d: Draw) => d.sentence(8 + d.int(12));
const formatted = (d: Draw) => {
  const link = d.words(2);
  return (
    `${d.sentence(4)} **${d.words(2)}** ${d.words(5)} ` +
    `[${link}](https://example.com/${link.replace(' ', '-')}/${d.pick()}) *${d.pick()}* ${d.sentence(6)}`
  );
};
const list = (d: Draw, item: () => string) =>
  Array.from({ length: 3 + d.int(6) }, () => `- ${item()}`).join('\n');
const fence = (d: Draw) => {
  const lines = Array.from({ length: 3 + d.int(28) }, () => {
    const roll = d.int(3);
    if (roll === 0) return `const ${d.pick()} = ${d.pick()}(${d.pick()});`;
    if (roll === 1) return `  ${d.pick()}: ${d.pick()}, // ${d.words(3)}`;
    return `${d.pick()}.${d.pick()}(${d.int(1000)});`;
  });
  return `\`\`\`${LANGUAGES[d.int(LANGUAGES.length)]}\n${lines.join('\n')}\n\`\`\``;
};
let references = 0;
const links = (d: Draw) => {
  const roll = d.int(3);
  if (roll === 0) {
    return `${d.words(3)} [${d.words(2)}](${d.url()}) ${d.words(3)} [${d.pick()}](${d.url()}) ${d.sentence(3)}`;
  }
  if (roll === 1) {
    const label = `ref${(references += 1)}`;
    return `${d.words(4)} [${d.words(2)}][${label}] ${d.sentence(4)}\n\n[${label}]: ${d.url()}`;
  }
  return `${d.words(4)} <${d.url()}> ${d.sentence(3)}`;
};
const image = (d: Draw) => {
  const roll = d.int(3);
  if (roll === 0) return `![${d.words(2)}](${d.url()}.png)`;
  if (roll === 1) return `![${d.words(2)}](${d.url()}.png "${d.words(2)}")`;
  return `${d.words(3)} ![${d.pick()}](${d.url()}.png) ${d.sentence(4)}`;
};
const table = (d: Draw) => {
  const columns = 2 + d.int(4);
  const cell = () => {
    const roll = d.rng();
    if (roll < 0.15) return `**${d.pick()}**`;
    if (roll < 0.25) return `[${d.pick()}](${d.url()})`;
    return d.words(1 + d.int(3));
  };
  const row = () => `| ${Array.from({ length: columns }, cell).join(' | ')} |`;
  const rows = Array.from({ length: 3 + d.int(8) }, row);
  return [row(), `|${' --- |'.repeat(columns)}`, ...rows].join('\n');
};

/** The block mixture of a typical note: headings, lists, code, formatted and plain paragraphs. */
function mixed(d: Draw): string {
  const roll = d.rng();
  if (roll < 0.1) return heading(d, 2 + d.int(2));
  if (roll < 0.35) return list(d, () => (d.rng() < 0.4 ? formatted(d) : plain(d)));
  if (roll < 0.45) return fence(d);
  if (roll < 0.7) return formatted(d);
  return plain(d);
}

/** Blocks drawn by `next` until the note holds `minLength` characters of markdown. */
function note(seed: number, minLength: number, next: (d: Draw) => string, title = true): string {
  references = 0;
  const d = draw(seed);
  const blocks = title ? [heading(d, 1)] : [];
  let length = blocks.reduce((n, block) => n + block.length, 0);
  while (length < minLength) {
    const block = next(d);
    blocks.push(block);
    length += block.length + 2;
  }
  return blocks.join('\n\n');
}

const SHAPES: Record<ShapeName, () => string> = {
  formatted: () =>
    note(
      11,
      THEMED_MIN_LENGTH,
      (d) => (d.rng() < 0.25 ? list(d, () => formatted(d)) : formatted(d)),
      false,
    ),
  mixed: () => note(12, THEMED_MIN_LENGTH, mixed),
  'link-heavy': () => note(13, THEMED_MIN_LENGTH, (d) => (d.rng() < 0.7 ? links(d) : plain(d))),
  'image-heavy': () => note(14, THEMED_MIN_LENGTH, (d) => (d.rng() < 0.7 ? image(d) : plain(d))),
  'table-heavy': () => note(15, THEMED_MIN_LENGTH, (d) => (d.rng() < 0.7 ? table(d) : plain(d))),
  'fenced-code-heavy': () =>
    note(16, THEMED_MIN_LENGTH, (d) => (d.rng() < 0.7 ? fence(d) : plain(d))),
  '150kib': () => note(17, 150 * KIB, mixed),
  '1mib': () => note(18, 1024 * KIB, mixed),
};

/** Every shape, in `TEXT_REBASE_SHAPE_NAMES` order; the same markdown on every call. */
export function textRebaseShapes(): TextRebaseShape[] {
  return TEXT_REBASE_SHAPE_NAMES.map((name) => ({ name, markdown: SHAPES[name]() }));
}
