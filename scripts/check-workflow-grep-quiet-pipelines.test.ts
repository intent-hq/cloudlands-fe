// @verify-changed-triggers: .github/workflows/*.yml
// @vitest-environment node

/**
 * Workflow `producer | grep -q` pipeline guard.
 *
 * GitHub Actions runs `shell: bash` steps under `bash -eo pipefail`. In a
 * `producer | grep -q pattern` pipeline grep exits at the first match and
 * closes its end of the pipe; a producer still writing (any input larger than
 * the pipe buffer) then dies of SIGPIPE, and under pipefail the pipeline
 * reports the producer's failure — so a *matched* input reads as "no match".
 * cloudlands-fe#2709 shipped a relevance step built this way that declared a
 * 98 KB matched diff "not relevant"
 * (https://github.com/intent-hq/cloudlands-fe/pull/2709#discussion_r4057405412).
 *
 * This suite fails on any non-comment workflow line that pipes into grep with
 * a quiet flag in any spelling (`-q`, `-Eq`, `-qE`, `--quiet`, `--silent`, …),
 * naming the file:line and the accepted rewrites. Reading the pattern's input
 * from a file or here-string (no producer process) is fine and is not flagged.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOWS_DIR = '.github/workflows';
// A single `|` (not `||`) followed by `grep` as a word. Every occurrence on a
// line is examined; the grep command runs until the next command terminator.
const PIPE_TO_GREP = /(?:^|[^|])\|(?!\|)\s*grep(?=[\s|;&<>()]|$)/g;
const COMMAND_TERMINATOR = /\||;|\(|\)|(?<![<>])&/;
const TOKEN_BOUNDARY = /[\s<>]+/;
const COMMENT_START = /[\s;|&(]/;
const LINE_CONTINUATION = /\s*\\\s*$/;
const SHORT_QUIET_FLAG = /^-[A-Za-z]*q[A-Za-z]*$/;
const LONG_QUIET_FLAGS = new Set(['--quiet', '--silent']);

const REWRITE_GUIDANCE = [
  'Under pipefail, `producer | grep -q pattern` fails on a large matched input: grep quits at the first match and the producer dies of SIGPIPE (cloudlands-fe#2709). Rewrite as:',
  '  - variable input:  grep -q pattern <<<"$VAR"          (here-string; no producer process)',
  '  - real producer:   producer | grep -E pattern >/dev/null   (drain instead of quitting)',
  '  - file input:      grep -q pattern file',
].join('\n');

interface WorkflowLine {
  line: number;
  text: string;
}

// Logical lines: a trailing `\` joins the next physical line, reported at the
// line where the command starts.
const codeLines = (workflow: string): WorkflowLine[] => {
  const lines: WorkflowLine[] = [];
  let open: WorkflowLine | undefined;
  workflow.split('\n').forEach((text, index) => {
    const continued = LINE_CONTINUATION.test(text);
    const body = text.replace(LINE_CONTINUATION, '');
    if (open) {
      open.text += ` ${body.trim()}`;
    } else {
      open = { line: index + 1, text: body };
      lines.push(open);
    }
    if (!continued) open = undefined;
  });
  return lines.filter(({ text }) => !text.trim().startsWith('#'));
};

const hasQuietFlag = (grepArgs: string): boolean => {
  const command = grepArgs.split(COMMAND_TERMINATOR, 1)[0];
  for (const token of command.split(TOKEN_BOUNDARY)) {
    if (token === '--') return false;
    if (SHORT_QUIET_FLAG.test(token) || LONG_QUIET_FLAGS.has(token)) return true;
  }
  return false;
};

type ShellContext = { kind: 'exec'; parens: number; closer?: ')' | '`' } | { kind: 'double' };

// The executable part of a logical line: single-quoted text and the literal
// parts of double-quoted text are blanked out, the body of a `$(…)` or `` `…` ``
// substitution inside double quotes is kept (it still runs), escaped characters
// are blanked, and an inline `#` comment ends the text. A quote with no closing
// mate on the line is kept verbatim so a multi-line string cannot hide a pipeline.
const executableText = (text: string): string => {
  const stack: ShellContext[] = [{ kind: 'exec', parens: 0 }];
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    if (ch === '\\') {
      out += '  ';
      i++;
    } else if (top.kind === 'double') {
      if (ch === '"') {
        stack.pop();
        out += ' ';
      } else if (ch === '$' && text[i + 1] === '(') {
        stack.push({ kind: 'exec', parens: 0, closer: ')' });
        out += '$(';
        i++;
      } else if (ch === '`' && text.indexOf('`', i + 1) !== -1) {
        stack.push({ kind: 'exec', parens: 0, closer: '`' });
        out += ' ';
      } else {
        out += ' ';
      }
    } else if (ch === '#' && (i === 0 || COMMENT_START.test(text[i - 1]))) {
      break;
    } else if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1);
      if (close === -1) {
        out += ch;
      } else if (ch === "'") {
        out += ' '.repeat(close - i + 1);
        i = close;
      } else {
        stack.push({ kind: 'double' });
        out += ' ';
      }
    } else if (
      (ch === ')' && top.closer === ')' && top.parens === 0) ||
      (ch === '`' && top.closer === '`')
    ) {
      stack.pop();
      out += ' ';
    } else {
      if (ch === '(') top.parens++;
      else if (ch === ')' && top.parens > 0) top.parens--;
      out += ch;
    }
  }
  return out;
};

const isQuietGrepPipeline = (text: string): boolean => {
  const executable = executableText(text);
  return [...executable.matchAll(PIPE_TO_GREP)].some((match) =>
    hasQuietFlag(executable.slice((match.index ?? 0) + match[0].length)),
  );
};

const findQuietGrepPipelines = (workflow: string): WorkflowLine[] =>
  codeLines(workflow).filter(({ text }) => isQuietGrepPipeline(text));

const describeHits = (file: string, hits: WorkflowLine[]) =>
  hits.map(({ line, text }) => `${file}:${line}: ${text.trim()}`).join('\n');

describe('workflow grep -q pipeline detector', () => {
  const run = (...lines: string[]) =>
    `      - name: step\n        run: |\n${lines.map((line) => `          ${line}`).join('\n')}\n`;
  const lineNumbers = (workflow: string) =>
    findQuietGrepPipelines(workflow).map(({ line }) => line);

  it.each([
    ['echo "$OUT" | grep -q "pattern"'],
    ["printf '%s' \"$X\" | grep -Eq '^v[0-9]+$'"],
    ["printf '%s' \"$X\" | grep -qE '^v[0-9]+$'"],
    ['cat file | grep -qi pattern'],
    ['dpkg-deb --contents "$deb" | grep -Fq usr/bin/intentd'],
    ['echo "$OUT" | grep --quiet pattern'],
    ['echo "$OUT" | grep --silent pattern'],
    ['echo "$OUT"|grep -q pattern'],
    ['echo "$OUT" |grep -q pattern'],
    ['echo "$OUT"| grep -q pattern'],
    ['xcrun simctl list runtimes 2>/dev/null | grep -q "^iOS "'],
    ['echo "$OUT" | grep -e pattern -q'],
    ['printf x | grep x | grep -q x'],
    ['printf x | grep x; printf x | grep -q x'],
    ['printf x | grep x -q>/dev/null'],
    ['printf x | grep x -q;'],
    ['echo "$OUT" | grep -E x >/dev/null | grep -q y'],
    ['echo "$OUT" | grep -q x 2>&1'],
    ['FOUND=$(printf x | grep -q x && echo yes)'],
    ['FOUND="$(seq 100000 | grep -q 1 && echo yes)"'],
    ['if [ -z "$(printf x | grep -q x)" ]; then'],
    ['echo "$(echo "a|b" | grep -q x)"'],
    ['FOUND="`printf x | grep -q x && echo yes`"'],
    ['echo "$OUT" | grep -e \'x|y\' -q'],
    ['echo "$OUT" | grep 2>/dev/null -q x'],
    ['echo ${#OUT} | grep -q x'],
    ['echo "$OUT" | grep -q x # comment'],
  ])('flags %s', (line) => {
    expect(lineNumbers(run('echo start', line))).toEqual([4]);
  });

  it('reports the file, line and trimmed text of each hit', () => {
    const workflow = run('echo "$A" | grep -q a', 'echo ok', 'echo "$B" | grep -Eq b');
    expect(describeHits('wf.yml', findQuietGrepPipelines(workflow))).toBe(
      'wf.yml:3: echo "$A" | grep -q a\nwf.yml:5: echo "$B" | grep -Eq b',
    );
  });

  it.each([
    ['grep -q pattern file'],
    ['grep -q pattern <<<"$OUT"'],
    ['if [ -n "$X" ] && ! grep -Eq \'^v\' <<<"$X"; then'],
    ['echo "$OUT" | grep -E pattern >/dev/null'],
    ['echo "$OUT" | grep -c pattern'],
    ['echo "$OUT" | grep pattern | head -1'],
    ['true || grep -q pattern file'],
    ['echo "$OUT" | grep pattern || grep -q other file'],
    ['echo "$OUT" | grep -E pattern >/dev/null && grep -q other file'],
    ['echo "$OUT" | grep-like -q pattern'],
    ['echo "$OUT" | grep -E "a -q b"'],
    ['echo "$OUT" | grep x >/dev/null; grep -q y file'],
    ['echo "$OUT" | grep x; echo "$OUT" | grep -E y >/dev/null'],
    ['echo "a|b" | grep x'],
    ['echo "$OUT" | grep x # no -q here'],
    ['echo "$OUT" | grep x # was: | grep -q x'],
    ['echo "$OUT" | grep -E \'has -q word\' >/dev/null'],
    ['echo "$(printf x | grep x)" | grep y'],
    ['echo \\"$OUT\\" | grep x'],
  ])('does not flag %s', (line) => {
    expect(lineNumbers(run('echo start', line))).toEqual([]);
  });

  it('joins backslash-continued lines and reports the starting line', () => {
    const workflow = run('echo start', 'echo "$OUT" | \\', '  grep -q pattern', 'echo done');
    expect(describeHits('wf.yml', findQuietGrepPipelines(workflow))).toBe(
      'wf.yml:4: echo "$OUT" | grep -q pattern',
    );
  });

  it('does not flag a backslash-continued drain', () => {
    const workflow = run('echo "$OUT" | \\', '  grep -E pattern >/dev/null', 'echo done');
    expect(lineNumbers(workflow)).toEqual([]);
  });

  it('ignores commented-out pipelines', () => {
    const workflow = run('# echo "$OUT" | grep -q pattern', 'echo ok');
    expect(lineNumbers(workflow)).toEqual([]);
  });

  it('flags a hit inside a single-line run', () => {
    const workflow = `      - name: step\n        run: echo "$OUT" | grep -q pattern\n`;
    expect(lineNumbers(workflow)).toEqual([2]);
  });
});

describe(`${WORKFLOWS_DIR}/*.yml`, () => {
  const dir = join(process.cwd(), WORKFLOWS_DIR);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .sort();

  it('has workflows to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s pipes nothing into a quiet grep', (name) => {
    const file = `${WORKFLOWS_DIR}/${name}`;
    const hits = findQuietGrepPipelines(readFileSync(join(dir, name), 'utf-8'));
    expect(hits, `${describeHits(file, hits)}\n\n${REWRITE_GUIDANCE}`).toEqual([]);
  });
});
