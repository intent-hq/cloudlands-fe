// pseudo-locale-lib.mjs — mechanical pseudo-locale (en-XA) generation.
//
// Transforms every message in messages/en.json into accented, expanded
// pseudo-English and writes messages/en-XA.json (gitignored — always
// regenerated, never hand-edited or translated). Running the app under en-XA
// makes unextracted strings obvious (they stay plain English, outside ⟦…⟧
// markers) and exercises text-expansion in layouts.
//
// Transform, per message:
//   - ASCII letters map to accented equivalents (Séttíngs → Śéťťíñğś-style),
//   - `{param}` placeholders are preserved verbatim,
//   - the text is padded with `·` to simulate ~40% translation growth,
//   - the whole message is wrapped in ⟦…⟧ so truncation is visible.
//
// Deterministic: same en.json in, same en-XA.json out.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PSEUDO_LOCALE = 'en-XA';

const ACCENT_MAP = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ĺ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'q̂',
  r: 'ŕ',
  s: 'š',
  t: 'ť',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ğ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ĺ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Q̂',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ť',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

// `{param}` placeholder as understood by the inlang message format — must
// survive the transform byte-for-byte so compiled functions still interpolate.
const PLACEHOLDER_RE = /\{[a-zA-Z_$][\w$]*\}/g;

function accent(text) {
  let out = '';
  for (const ch of text) out += ACCENT_MAP[ch] ?? ch;
  return out;
}

/** Pseudo-localize one message: accent + expand + wrap, placeholders intact. */
export function pseudoize(message) {
  const parts = message.split(PLACEHOLDER_RE);
  const placeholders = message.match(PLACEHOLDER_RE) ?? [];
  let body = '';
  parts.forEach((part, i) => {
    body += accent(part);
    if (i < placeholders.length) body += placeholders[i];
  });
  // ~40% expansion, measured on the visible text (placeholders excluded —
  // their runtime values expand on their own).
  const visibleLength = parts.reduce((sum, part) => sum + part.length, 0);
  const padding = '·'.repeat(Math.ceil(visibleLength * 0.4));
  return padding.length > 0 ? `⟦${body} ${padding}⟧` : `⟦${body}⟧`;
}

/** Build the full pseudo catalog object from a parsed en.json object. */
export function buildPseudoCatalog(baseCatalog) {
  const catalog = {
    $schema: 'https://inlang.com/schema/inlang-message-format',
  };
  for (const [key, value] of Object.entries(baseCatalog)) {
    if (key === '$schema') continue;
    catalog[key] = pseudoize(value);
  }
  return catalog;
}

/**
 * Read `messages/en.json` under `rootDir` and write `messages/en-XA.json`.
 * Called from generate:i18n, vite.config.mjs, and vitest.config.ts so the
 * catalog exists wherever the Paraglide compiler runs.
 */
export function writePseudoCatalog(rootDir) {
  const base = JSON.parse(readFileSync(join(rootDir, 'messages/en.json'), 'utf8'));
  const outPath = join(rootDir, `messages/${PSEUDO_LOCALE}.json`);
  writeFileSync(outPath, `${JSON.stringify(buildPseudoCatalog(base), null, 2)}\n`);
  return outPath;
}
