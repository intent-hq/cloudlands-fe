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

function runGate(args: string[] = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
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
        'src/features/new-workspace/sandbox/scenarios.ts':
          "export const title = 'Developer sandbox scenario';",
        'chat/streaming-status.preview-fixtures.svelte':
          '<span>Product preview fixtures sentence</span>',
        'card/Card.svelte': '<span>Rendered product text</span>',
      },
      (dir) => {
        const result = runGate([dir]);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('Excluded 12 scaffolding file(s)');
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
        expect(result.output).not.toContain('Developer sandbox scenario');
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
