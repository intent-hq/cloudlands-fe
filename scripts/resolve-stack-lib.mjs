/**
 * Pure helpers for scripts/resolve-stack.mjs — side-effect free apart from the
 * read-only filesystem walk in indexSourceMaps, so they can be unit-tested with
 * vitest (scripts/resolve-stack-lib.test.ts).
 *
 * The Source Map v3 decoder is inlined: under pnpm's isolated linker neither
 * `source-map` nor `@jridgewell/trace-mapping` is resolvable from scripts/ (both
 * are transitive), and the format is small enough that a dependency is not worth
 * the resolution trouble that cost the intent-hq/intent#4550 investigation.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

const V8_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(\S+?):(\d+)(?::(\d+))?\)?\s*$/;
const GECKO_FRAME_RE = /^\s*(?:([^@\s]*)@)?(\S+?):(\d+)(?::(\d+))?\s*$/;
const JS_FILE_RE = /\.[cm]?js$/;

/** Classify one stack-trace line as a bundle frame or passthrough text. */
export function parseStackLine(raw) {
  const match = V8_FRAME_RE.exec(raw) ?? GECKO_FRAME_RE.exec(raw);
  if (!match) return { kind: 'text', raw };
  const [, fn, url, line, column] = match;
  const file = basename(url.replace(/[?#].*$/, ''));
  if (!JS_FILE_RE.test(file)) return { kind: 'text', raw };
  return {
    kind: 'frame',
    raw,
    fn: fn?.trim() || null,
    url,
    file,
    line: Number(line),
    column: column === undefined ? null : Number(column),
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_VALUE = new Map([...BASE64].map((char, index) => [char, index]));

function decodeVlqSegment(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = VLQ_VALUE.get(char);
    if (digit === undefined) throw new Error(`Invalid VLQ character "${char}" in mappings`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * Decode a v3 `mappings` string into one array per generated line, each holding
 * absolute `[generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex]`
 * segments (0-based; missing fields are null). Segments stay in emission order,
 * which the spec requires to be ascending by generated column.
 */
export function decodeMappings(mappings) {
  const lines = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;
  for (const encodedLine of mappings.split(';')) {
    const segments = [];
    let generatedColumn = 0;
    for (const encoded of encodedLine.split(',')) {
      if (!encoded) continue;
      const fields = decodeVlqSegment(encoded);
      generatedColumn += fields[0];
      if (fields.length === 1) {
        segments.push([generatedColumn, null, null, null, null]);
        continue;
      }
      sourceIndex += fields[1];
      sourceLine += fields[2];
      sourceColumn += fields[3];
      if (fields.length >= 5) nameIndex += fields[4];
      segments.push([
        generatedColumn,
        sourceIndex,
        sourceLine,
        sourceColumn,
        fields.length >= 5 ? nameIndex : null,
      ]);
    }
    lines.push(segments);
  }
  return lines;
}

/** Parse a source map JSON document into a lookup structure. */
export function parseSourceMap(json) {
  const raw = JSON.parse(json);
  if (raw.version !== 3 || typeof raw.mappings !== 'string') {
    throw new Error('Unsupported source map: expected a v3 map with a mappings string');
  }
  return {
    sources: raw.sources ?? [],
    names: raw.names ?? [],
    sourceRoot: raw.sourceRoot ?? '',
    lines: decodeMappings(raw.mappings),
  };
}

function segmentAt(map, line, column) {
  const segments = map.lines[line - 1];
  if (!segments) return null;
  const target = column - 1;
  let low = 0;
  let high = segments.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid][0] <= target) {
      found = segments[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Map a 1-based generated `line:column` (as printed by V8) to its original
 * position, also 1-based. Returns null when nothing maps there.
 */
export function originalPositionFor(map, line, column) {
  const segment = segmentAt(map, line, column);
  if (!segment || segment[1] === null) return null;
  return {
    source: map.sources[segment[1]] ?? null,
    line: segment[2] + 1,
    column: segment[3] + 1,
    name: segment[4] === null ? null : (map.names[segment[4]] ?? null),
  };
}

/** Distinct original sources touched by a generated line, with their 1-based line span. */
export function sourcesOnLine(map, line) {
  const spans = new Map();
  for (const segment of map.lines[line - 1] ?? []) {
    if (segment[1] === null) continue;
    const source = map.sources[segment[1]];
    const originalLine = segment[2] + 1;
    const span = spans.get(source);
    if (!span) spans.set(source, { source, firstLine: originalLine, lastLine: originalLine });
    else {
      span.firstLine = Math.min(span.firstLine, originalLine);
      span.lastLine = Math.max(span.lastLine, originalLine);
    }
  }
  return [...spans.values()];
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Render a map `source` for humans: virtual modules and URLs verbatim, file paths
 * resolved against the map's directory and shown relative to `baseDir` when inside it.
 */
export function displaySource(source, mapDir, baseDir, sourceRoot = '') {
  if (source.startsWith('\0') || URL_SCHEME_RE.test(source)) return source;
  const absolute = resolve(mapDir, sourceRoot, source);
  const rel = relative(baseDir, absolute);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : absolute;
}

/** Walk `distDir` and index every `*.js.map` by the basename of the bundle it describes. */
export function indexSourceMaps(distDir) {
  const index = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.js.map')) index.set(entry.name.slice(0, -4), path);
    }
  };
  walk(distDir);
  return index;
}

const ROUTE_NODE_RE = /^(\d+)\.[\w-]+\.js$/;

/**
 * Find the map for a bundle basename. SvelteKit route nodes are named
 * `<node-id>.<hash>.js` and the node id is stable across builds, so when the
 * exact hash is absent the same node from this build is offered as an
 * approximate match (the caller flags it; a hash mismatch means the contents
 * differ, so positions can be off).
 */
export function lookupMap(index, file) {
  const exact = index.get(file);
  if (exact) return { mapPath: exact, matchedFile: file, approximate: false };
  const node = ROUTE_NODE_RE.exec(file)?.[1];
  if (node === undefined) return null;
  for (const [candidate, mapPath] of index) {
    if (ROUTE_NODE_RE.exec(candidate)?.[1] === node) {
      return { mapPath, matchedFile: candidate, approximate: true };
    }
  }
  return null;
}

/**
 * Resolve every frame in `stack`. `index` maps bundle basenames to map paths and
 * `loadMap(path)` returns a parsed map (defaults to a per-call memoized reader);
 * `baseDir` anchors the displayed source paths.
 */
export function resolveStack(stack, { index, baseDir, loadMap = defaultMapLoader() }) {
  return stack.split(/\r?\n/).map((raw) => {
    const parsed = parseStackLine(raw);
    if (parsed.kind !== 'frame') return parsed;
    const hit = lookupMap(index, parsed.file);
    if (!hit) {
      return {
        ...parsed,
        resolved: null,
        reason: `no sourcemap for ${parsed.file} (chunk hash differs from this build?)`,
      };
    }
    const { mapPath, matchedFile, approximate } = hit;
    const frame = approximate ? { ...parsed, approximate: matchedFile } : parsed;
    const map = loadMap(mapPath);
    const mapDir = resolve(mapPath, '..');
    const show = (source) => displaySource(source, mapDir, baseDir, map.sourceRoot);
    if (parsed.column === null) {
      const spans = sourcesOnLine(map, parsed.line);
      if (spans.length === 0) {
        return { ...frame, resolved: null, reason: `no mapping on line ${parsed.line}` };
      }
      return {
        ...frame,
        resolved: { spans: spans.map((s) => ({ ...s, source: show(s.source) })) },
      };
    }
    const position = originalPositionFor(map, parsed.line, parsed.column);
    if (!position) {
      return { ...frame, resolved: null, reason: `no mapping at ${parsed.line}:${parsed.column}` };
    }
    return { ...frame, resolved: { ...position, source: show(position.source) } };
  });
}

function defaultMapLoader() {
  const cache = new Map();
  return (path) => {
    let map = cache.get(path);
    if (!map) {
      map = parseSourceMap(readFileSync(path, 'utf8'));
      cache.set(path, map);
    }
    return map;
  };
}

/** One output line per resolveStack entry: text verbatim, frames resolved or flagged. */
export function formatFrame(entry) {
  if (entry.kind !== 'frame') return entry.raw;
  if (!entry.resolved) return `${entry.raw}    # unresolved: ${entry.reason}`;
  const generated = `${entry.file}:${entry.line}${entry.column === null ? '' : `:${entry.column}`}`;
  const approx = entry.approximate
    ? `    # approximate: hash mismatch, used ${entry.approximate}`
    : '';
  const origin = `<- ${generated}${entry.fn ? ` (${entry.fn})` : ''}${approx}`;
  if (entry.resolved.spans) {
    const spans = entry.resolved.spans
      .map((s) => `${s.source}:${s.firstLine}${s.lastLine === s.firstLine ? '' : `-${s.lastLine}`}`)
      .join(', ');
    return `${spans} (no column)    ${origin}`;
  }
  const { source, line, column, name } = entry.resolved;
  return `${source}:${line}:${column} ${name ?? entry.fn ?? '<anonymous>'}    ${origin}`;
}

const SHELL_META_RE = /["'`$|;<>()\\]/;

/**
 * Turn a package.json `build:renderer` chain into spawnable steps with the
 * sourcemap kill switch removed. Only the simple `a && b && c` shape with
 * `cross-env KEY=VALUE …` prefixes is supported; anything needing a real shell
 * is rejected so the caller can fall back to `--dist`.
 */
export function planRendererBuild(script) {
  if (SHELL_META_RE.test(script)) {
    throw new Error(`build:renderer script cannot be split into plain commands: ${script}`);
  }
  return script.split('&&').map((segment) => {
    const tokens = segment.trim().split(/\s+/);
    if (tokens[0] === 'cross-env') tokens.shift();
    const env = {};
    while (tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[0])) {
      const [key, ...rest] = tokens.shift().split('=');
      if (key !== 'INTENT_DISABLE_SOURCEMAPS') env[key] = rest.join('=');
    }
    if (!tokens.length) throw new Error(`build:renderer segment has no command: ${segment}`);
    return { command: tokens[0], args: tokens.slice(1), env };
  });
}
