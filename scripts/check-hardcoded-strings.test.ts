// @verify-changed-triggers: scripts/check-hardcoded-strings.mjs, scripts/hardcoded-strings-scope.mjs, scripts/hardcoded-strings-baseline.json

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/check-hardcoded-strings.mjs');

const regexCases = [
  ['single quotes', "/'Save your work'/"],
  ['double quotes', '/"Save your work"/'],
  ['backticks', '/`Save your work`/'],
  ['unpaired backtick', '/`/'],
  ['character classes', '/["\'`/]/g'],
  ['escaped slash and backslash', String.raw`/\\\/'Save your work'/gi`],
  ['escaped closing bracket', String.raw`/[\]/]'Save your work'/`],
  ['comment-like text', String.raw`/[/*]+'Save your work'[//]+/`],
];

function withFixture(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'hardcoded-strings-gate-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGate(args: string[] = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stripVTControlCharacters(stdout) };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: stripVTControlCharacters(
        `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
      ),
    };
  }
}

describe('hardcoded user-facing string gate', () => {
  it('passes the unannotated historical Markdown regex sequence from intent#5855', () => {
    // Reduced from reasoning-heading.ts at b55c5be7a6118dbe2025bdb0c540145a0e38c7a3.
    // Keep the earlier inline regexes and the later setext regex: their backticks
    // used to make the scanner consume intervening source as display text.
    const source = [
      'export interface ReasoningHeading {',
      '  heading: string | null;',
      '  body: string;',
      '}',
      '',
      'export interface ReasoningHistoryItem {',
      '  title: string | null;',
      '  body: string;',
      '}',
      '',
      'const MAX_TITLE_CHARACTERS = 80;',
      'const MAX_TITLE_WORDS = 10;',
      '',
      'function markdownInlineToPlainText(value: string): string {',
      '  return value',
      "    .replace(/!\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')",
      "    .replace(/\\[([^\\]]+)\\]\\([^)]*\\)/g, '$1')",
      "    .replace(/`+([^`]*?)`+/g, '$1')",
      "    .replace(/<[^>]+>/g, '')",
      "    .replace(/\\\\([\\\\`*_[\\]{}()#+\\-.!>])/g, '$1')",
      "    .replace(/[*~]/g, '')",
      "    .replace(/(^|[^A-Za-z0-9])_+/g, '$1')",
      "    .replace(/_+([^A-Za-z0-9]|$)/g, '$1')",
      "    .replace(/\\s+/g, ' ')",
      '    .trim();',
      '}',
      '',
      'function bodyAfterHeading(content: string, end: number): string {',
      "  return content.slice(end).replace(/^(?:[ \\t]*(?:\\r\\n|\\n|\\r))+/, '');",
      '}',
      '',
      'function isShortTitleLike(rawLine: string, plainText: string): boolean {',
      '  if (!plainText || plainText.length > MAX_TITLE_CHARACTERS) return false;',
      '  if (plainText.split(/\\s+/).length > MAX_TITLE_WORDS) return false;',
      '  if (/[.!?;]$/.test(plainText)) return false;',
      '  return !/^[ \\t]*(?:[-+*][ \\t]+|\\d+[.)][ \\t]+|>|```|~~~|\\|)/.test(rawLine);',
      '}',
      '',
      'export function extractStandaloneReasoningTitle(content: string): string | null {',
      '  const candidate = content.trim();',
      '  const strongTitle = candidate.match(/^\\*\\*([^\\r\\n]+)\\*\\*$/);',
      '  if (!strongTitle) return null;',
      '',
      '  const title = markdownInlineToPlainText(strongTitle[1]);',
      '  return isShortTitleLike(strongTitle[0], title) ? title : null;',
      '}',
      '',
      'function isStandaloneSetextTitle(line: string): boolean {',
      "  const candidate = line.replace(/^ {0,3}/, '');",
      '  // These start other Markdown blocks, even when a horizontal rule follows.',
      '  return (',
      '    !/^(?:\\s|>|`{3}|~{3}|(?:[-+*]|\\d+[.)])(?:[ \\t]|$)|#{1,6}(?:[ \\t]|$)|<|\\[[^\\]]*\\]:)/.test(',
      '      candidate,',
      '    ) && !/^(?:(?:\\*[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:-[ \\t]*){3,})$/.test(candidate)',
      '  );',
      '}',
    ].join('\n');
    withFixture({ 'reasoning-heading.ts': source }, (dir) => {
      const result = runGate([dir]);
      expect(result.exitCode, result.output).toBe(0);
    });
  });

  it.each(regexCases)('ignores regex syntax containing %s', (_name, regex) => {
    withFixture({ 'syntax.ts': `const pattern = ${regex};` }, (dir) => {
      const result = runGate([dir]);
      expect(result.exitCode, result.output).toBe(0);
    });
  });

  it.each(regexCases)('finds strings and templates on either side of %s', (_name, regex) => {
    withFixture(
      {
        'display.ts': [
          'const before = "Save your work";',
          'const beforeTemplate = `Save ${name} work`;',
          `const pattern = ${regex};`,
          "const after = 'Keep your changes';",
          'const afterTemplate = `Keep ${name} changes`;',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('display.ts:1  [string literal] "Save your work"');
        expect(result.output).toContain('display.ts:2  [string literal] "Save work"');
        expect(result.output).toContain('display.ts:4  [string literal] "Keep your changes"');
        expect(result.output).toContain('display.ts:5  [string literal] "Keep changes"');
        expect(result.output).toContain('Found 4 new or changed hardcoded-string violation(s)');
      },
    );
  });

  it('ignores regex literals in return, control-flow, and array expressions', () => {
    withFixture(
      {
        'regex.ts': [
          "function pattern() { return /'Save your work'/; }",
          'if (enabled) /"Save your work"/.test(value);',
          'while (enabled) /`Save your work`/.exec(value);',
          'if (enabled) {} /`Save your work`/.test(value);',
          'const patterns = [/`Save your work`/, /"Save your work"/];',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode, result.output).toBe(0);
      },
    );
  });

  it('still detects display strings used as division operands', () => {
    withFixture(
      {
        'division.ts': [
          "const first = amount / 'Choose valid divisor'.length / 2;",
          'const second = readTotal() / "Pick valid divisor".length / scale;',
          'const third = (amount + offset) / `Choose ${kind} divisor`.length / 2;',
          "amount /= divisor || 'Select valid divisor';",
          'amount++ / "Use another divisor".length / 2;',
          'const ratio = amount! / "Choose another divisor".length / 2;',
          'const label = "Save / your work";',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([join(dir, 'division.ts')]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('division.ts:1  [string literal] "Choose valid divisor"');
        expect(result.output).toContain('division.ts:2  [string literal] "Pick valid divisor"');
        expect(result.output).toContain('division.ts:3  [string literal] "Choose divisor"');
        expect(result.output).toContain('division.ts:4  [string literal] "Select valid divisor"');
        expect(result.output).toContain('division.ts:5  [string literal] "Use another divisor"');
        expect(result.output).toContain('division.ts:6  [string literal] "Choose another divisor"');
        expect(result.output).toContain('division.ts:7  [string literal] "Save / your work"');
        expect(result.output).toContain('Found 7 new or changed hardcoded-string violation(s)');
      },
    );
  });

  it('keeps original line numbers around regexes in both Svelte scripts', () => {
    withFixture(
      {
        'Example.svelte': [
          '<!-- component shell -->',
          '<script module lang="ts">',
          '  const before = "Save your work";',
          '  const pattern = /`/;',
          '  const after = `Keep ${name} changes`;',
          '</script>',
          '',
          '<script lang="ts">',
          "  const first = 'Choose your workspace';",
          "  const rule = /[//]+'Save your work'/;",
          '  const last = `Open ${name} workspace`;',
          '</script>',
          '<div>{before}</div>',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('Example.svelte:3  [string literal] "Save your work"');
        expect(result.output).toContain('Example.svelte:5  [string literal] "Keep changes"');
        expect(result.output).toContain(
          'Example.svelte:9  [string literal] "Choose your workspace"',
        );
        expect(result.output).toContain('Example.svelte:11  [string literal] "Open workspace"');
        expect(result.output).toContain('Found 4 new or changed hardcoded-string violation(s)');
      },
    );
  });

  it('preserves template interpolation and multiline string locations around nested regexes', () => {
    withFixture(
      {
        'template.ts': [
          'const inline = `Save ${/["\'`{}]/.test(name) ? name : fallback} work`;',
          'const multiline = `Keep',
          '${name}',
          'changes`;',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('template.ts:1  [string literal] "Save work"');
        expect(result.output).toContain('template.ts:2  [string literal] "Keep changes"');
        expect(result.output).toContain('Found 2 new or changed hardcoded-string violation(s)');
      },
    );
  });

  it('preserves comments, escapes, and ignore annotations around regexes', () => {
    withFixture(
      {
        'syntax.ts': [
          '// "Comment before pattern"',
          'const pattern = /`/; // "Comment after pattern"',
          '/* "Block comment with /slashes/"',
          '   `Another comment sentence` */',
          '// i18n-ignore (deliberate display example)',
          'const keep = "Save your work";',
          'const escaped = "Keep \\"your\\" changes"; // i18n-ignore',
          'const after = `Open ${name} workspace`;',
          'const rawTemplate = `Keep your /changes/`;',
          'const url = "https://example.com";',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('syntax.ts:8  [string literal] "Open workspace"');
        expect(result.output).toContain('syntax.ts:9  [string literal] "Keep your /changes/"');
        expect(result.output).toContain('Found 2 new or changed hardcoded-string violation(s)');
      },
    );
  });

  it.each(['logger.info', 'console.warn', 'log.debug', 'log.info', 'log.warn', 'log.error'])(
    'keeps multiline %s arguments non-display without hiding nested or surrounding UI strings',
    (loggingCall) => {
      withFixture(
        {
          'logging.ts': [
            "showToast('Review your work');",
            'const pattern = /`/;',
            `${loggingCall}(`,
            "  'Background worker is ready',",
            ');',
            `${loggingCall}(`,
            '  `Background ${name} worker`,',
            ');',
            `${loggingCall}(`,
            "  showToast('Save your work'),",
            ');',
            `${loggingCall}(`,
            "  () => 'Keep your changes',",
            ');',
            "showToast('Open your workspace');",
          ].join('\n'),
        },
        (dir) => {
          const result = runGate([dir]);
          expect(result.exitCode).toBe(1);
          expect(result.output).toContain('logging.ts:1  [string literal] "Review your work"');
          expect(result.output).toContain('logging.ts:10  [string literal] "Save your work"');
          expect(result.output).toContain('logging.ts:13  [string literal] "Keep your changes"');
          expect(result.output).toContain('logging.ts:15  [string literal] "Open your workspace"');
          expect(result.output).toContain('Found 4 new or changed hardcoded-string violation(s)');
        },
      );
    },
  );

  it.each(['log.trace', 'dialog.info', 'catalog.warn'])(
    'does not extend the logging exemption to %s',
    (callee) => {
      withFixture(
        {
          'display.ts': `${callee}(\n  'Save your work',\n  \`Keep your changes\`,\n);`,
        },
        (dir) => {
          const result = runGate([dir]);
          expect(result.exitCode).toBe(1);
          expect(result.output).toContain('display.ts:2  [string literal] "Save your work"');
          expect(result.output).toContain('display.ts:3  [string literal] "Keep your changes"');
          expect(result.output).toContain('Found 2 new or changed hardcoded-string violation(s)');
        },
      );
    },
  );

  it('scans the full intended path inventory and passes with an empty baseline', () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Scanning: src/lib/components/');
    expect(result.output).toContain('Scanning: src/features/workspace/');
    expect(result.output).toContain('Scanning: src/routes/(app)/workspace/');
    expect(result.output).toMatch(/Known i18n debt:.*0 violation\(s\).*0 stable baseline entries/);
    expect(result.output).toMatch(/Excluded [1-9][0-9]* scaffolding file\(s\)/);
    expect(result.output).toContain('✓ No new or changed hardcoded-string violations found.');
  });

  it('skips developer-facing scaffolding files but still checks siblings', () => {
    withFixture(
      {
        'card/CardHarness.svelte': '<span>Harness only demo text</span>',
        'combobox/combobox.test-harness.svelte': '<span>Test harness demo text</span>',
        'badge/badge.fixtures.ts': "export const label = 'Fixture demo sentence';",
        'button/button.preview.ts': "export const title = 'Button preview sentence';",
        'chat/streaming-status.preview-fixtures.ts':
          "export const message = 'Streaming preview fixture sentence';",
        'workspace/workspace-sidebar.preview.svelte': '<span>Workspace preview sentence</span>',
        'badge/badge.meta.ts': "export const description = 'Catalog metadata sentence';",
        'badge/badge.preview.ts': "export const title = 'Preview title sentence';",
        'badge/badge.preview-fixtures.ts': "export const label = 'Preview fixture sentence';",
        'badge/badge.preview.svelte': '<span>Preview component sentence</span>',
        'card/operate-patterns.playwright.config.ts': "export const name = 'Desktop Chrome';",
        'chat/streaming-status.preview-fixtures.svelte':
          '<span>Product preview fixtures sentence</span>',
        'card/Card.svelte': '<span>Rendered product text</span>',
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('Excluded 11 scaffolding file(s)');
        expect(result.output).toContain('[template text] "Rendered product text"');
        expect(result.output).toContain('[template text] "Product preview fixtures sentence"');
        expect(result.output).not.toContain('Harness only demo text');
        expect(result.output).not.toContain('Test harness demo text');
        expect(result.output).not.toContain('Fixture demo sentence');
        expect(result.output).not.toContain('Button preview sentence');
        expect(result.output).not.toContain('Streaming preview fixture sentence');
        expect(result.output).not.toContain('Workspace preview sentence');
        expect(result.output).not.toContain('Catalog metadata sentence');
        expect(result.output).not.toContain('Preview title sentence');
        expect(result.output).not.toContain('Preview fixture sentence');
        expect(result.output).not.toContain('Preview component sentence');
        expect(result.output).not.toContain('Desktop Chrome');
      },
    );
  });

  it('flags literal template text and user-facing attributes in Svelte files', () => {
    withFixture(
      {
        'Example.svelte': [
          '<script lang="ts">',
          "  let name = $state('');",
          '</script>',
          '',
          '<button title="Save your work">Save changes</button>',
          '<input placeholder="Enter a name" />',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[template text] "Save changes"');
        expect(result.output).toContain('[attribute title] "Save your work"');
        expect(result.output).toContain('[attribute placeholder] "Enter a name"');
      },
    );
  });

  it('passes on m.* message usage in templates and attributes', () => {
    withFixture(
      {
        'Example.svelte': [
          '<script lang="ts">',
          "  import { m } from '$lib/paraglide/messages';",
          '</script>',
          '',
          '<button title={m.save_tooltip()}>{m.save_changes()}</button>',
          '<input placeholder={m.name_placeholder()} aria-label={m.name_label()} />',
          '{#if true}',
          '  <span>{m.status_ready()}</span>',
          '{/if}',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('✓ No new or changed hardcoded-string violations found.');
      },
    );
  });

  it('flags string literals inside expression-valued attributes and tooltip attributes', () => {
    withFixture(
      {
        'Example.svelte': [
          '<script lang="ts">',
          '  let pinned = $state(false);',
          '</script>',
          '',
          "<button title={pinned ? 'Unpin from list' : 'Pin to list'}>x</button>",
          '<div tooltip="Open in browser">y</div>',
          "<div tooltip={pinned ? m.a_b() : 'Collapse all'}>z</div>",
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[attribute title] "Unpin from list"');
        expect(result.output).toContain('[attribute title] "Pin to list"');
        expect(result.output).toContain('[attribute tooltip] "Open in browser"');
        expect(result.output).toContain('[attribute tooltip] "Collapse all"');
      },
    );
  });

  it('passes on equality-comparison operands inside expression-valued attributes', () => {
    withFixture(
      {
        'Example.svelte': [
          '<script lang="ts">',
          "  import { m } from '$lib/paraglide/messages';",
          "  let kind = $state('blocker');",
          '</script>',
          '',
          "<div title={kind === 'blocker' ? m.blocker_title() : m.discussion_title()}>a</div>",
          "<div title={kind !== 'blocker' ? m.discussion_title() : m.blocker_title()}>b</div>",
          "<div aria-label={kind == 'blocker' ? m.blocker_title() : m.discussion_title()}>c</div>",
          "<div aria-label={kind != 'blocker' ? m.discussion_title() : m.blocker_title()}>d</div>",
          "<div title={'blocker' === kind ? m.blocker_title() : m.discussion_title()}>e</div>",
          "<div title={kind==='blocker' ? m.blocker_title() : m.discussion_title()}>f</div>",
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.output).not.toContain('[attribute title] "blocker"');
        expect(result.output).not.toContain('[attribute aria-label] "blocker"');
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('still flags rendered literals next to comparison operands in expression-valued attributes', () => {
    withFixture(
      {
        'Example.svelte': [
          '<script lang="ts">',
          "  import { m } from '$lib/paraglide/messages';",
          "  let kind = $state('blocker');",
          "  let x = $state('');",
          '</script>',
          '',
          "<div title={kind === 'blocker' ? 'Blocker raised' : m.discussion_title()}>a</div>",
          "<div title={'Hello world'}>b</div>",
          '<div aria-label={`Hello ${x}`}>c</div>',
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[attribute title] "Blocker raised"');
        expect(result.output).not.toContain('[attribute title] "blocker"');
        expect(result.output).toContain('[attribute title] "Hello world"');
        expect(result.output).toContain('[attribute aria-label] "Hello');
        expect(result.output).toMatch(/Found 3 new/);
      },
    );
  });

  it('flags || fallback literals in template expressions but not m.* usage', () => {
    withFixture(
      {
        'Example.svelte': [
          '<script lang="ts">',
          '  let title = $state("");',
          '</script>',
          '',
          "<span>{title || 'Untitled'}</span>",
          '<span>{title || m.fallback_label()}</span>',
          "<span class={title || 'text-subtle'}></span>",
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[fallback literal] "Untitled"');
        expect(result.output).not.toContain('fallback_label');
        expect(result.output).not.toContain('text-subtle');
      },
    );
  });

  it('flags sentence-like string literals in TS but tolerates non-UI strings', () => {
    withFixture(
      {
        'toast-service.ts': [
          "const cls = 'flex items-center gap-2';",
          "const path = 'src/features/settings/index.ts';",
          "console.error('Something went wrong while logging');",
          "throw new Error('Internal invariant was violated');",
          "showToast('Failed to save note');",
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[string literal] "Failed to save note"');
        expect(result.output).not.toContain('flex items-center');
        expect(result.output).not.toContain('Something went wrong');
        expect(result.output).not.toContain('Internal invariant');
      },
    );
  });

  it('honors i18n-ignore comments and skips test files', () => {
    withFixture(
      {
        'Example.svelte': [
          '<!-- i18n-ignore -->',
          '<span>Brand Name</span>',
          '<script lang="ts">',
          "  const keep = 'Deliberate literal here'; // i18n-ignore",
          '</script>',
        ].join('\n'),
        'example.test.ts': "const msg = 'This sentence would otherwise fail';",
        '__tests__/helper.ts': "const msg = 'Another sentence that would fail';",
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(0);
      },
    );
  });

  it('does not let an inline i18n-ignore suppress the following line', () => {
    withFixture(
      {
        'toast-service.ts': [
          "const keep = 'Deliberate literal here'; // i18n-ignore",
          "showToast('Failed to save note');",
        ].join('\n'),
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[string literal] "Failed to save note"');
        expect(result.output).not.toContain('Deliberate literal here');
      },
    );
  });

  it('allows known debt but fails when a baseline violation changes', () => {
    withFixture({ 'Example.svelte': '<button>Save changes</button>' }, (dir) => {
      const baseline = join(dir, 'baseline.json');
      const update = runGate([dir, '--baseline', baseline, '--update-baseline']);
      expect(update.exitCode).toBe(0);

      const known = runGate([dir, '--baseline', baseline]);
      expect(known.exitCode).toBe(0);
      expect(known.output).toContain('Known i18n debt:');

      writeFileSync(join(dir, 'Example.svelte'), '<button>Save different changes</button>');
      const changed = runGate([dir, '--baseline', baseline]);
      expect(changed.exitCode).toBe(1);
      expect(changed.output).toContain('[New or changed hardcoded user-facing strings]');
      expect(changed.output).toContain('"Save different changes"');
    });
  });

  it('fails when an identical violation is added beyond its baseline count', () => {
    withFixture({ 'Example.svelte': '<span>Save changes</span>' }, (dir) => {
      const baseline = join(dir, 'baseline.json');
      expect(runGate([dir, '--baseline', baseline, '--update-baseline']).exitCode).toBe(0);

      writeFileSync(
        join(dir, 'Example.svelte'),
        '<span>Save changes</span>\n<span>Save changes</span>',
      );
      const result = runGate([dir, '--baseline', baseline]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('1 new or changed hardcoded-string violation');
    });
  });

  it('does not treat line-only movement as changed debt', () => {
    withFixture({ 'Example.svelte': '<span>Save changes</span>' }, (dir) => {
      const baseline = join(dir, 'baseline.json');
      expect(runGate([dir, '--baseline', baseline, '--update-baseline']).exitCode).toBe(0);

      writeFileSync(join(dir, 'Example.svelte'), '\n\n<span>Save changes</span>');
      const result = runGate([dir, '--baseline', baseline]);
      expect(result.exitCode).toBe(0);
    });
  });

  it('exits 2 when an enforced directory is missing', () => {
    const result = runGate([join(tmpdir(), 'definitely-missing-dir-i18n-gate')]);
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Enforced path not found');
  });
});
