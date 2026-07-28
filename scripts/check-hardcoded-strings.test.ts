import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts/check-hardcoded-strings.mjs');

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

function runGate(dir?: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...(dir ? [dir] : [])], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('hardcoded user-facing string gate', () => {
  it('passes on the enforced directories', () => {
    const result = runGate();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('✓ No hardcoded-string violations found.');
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
        const result = runGate(dir);
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
        const result = runGate(dir);
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain('✓ No hardcoded-string violations found.');
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
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[attribute title] "Unpin from list"');
        expect(result.output).toContain('[attribute title] "Pin to list"');
        expect(result.output).toContain('[attribute tooltip] "Open in browser"');
        expect(result.output).toContain('[attribute tooltip] "Collapse all"');
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
        const result = runGate(dir);
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
        const result = runGate(dir);
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
        const result = runGate(dir);
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
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('[string literal] "Failed to save note"');
        expect(result.output).not.toContain('Deliberate literal here');
      },
    );
  });

  it('exits 2 when an enforced directory is missing', () => {
    const result = runGate(join(tmpdir(), 'definitely-missing-dir-i18n-gate'));
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Enforced path not found');
  });
});
