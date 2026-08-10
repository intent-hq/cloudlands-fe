/**
 * @vitest-environment jsdom
 *
 * Regression tests for ReleaseNotesModal markdown rendering
 * (intent-hq/monorepo#1748, intent-hq/monorepo#1875).
 *
 * Mounts the real modal with a markdown release body and asserts the notes
 * render as HTML (headings, lists, links, inline code) — not as escaped plain
 * text — via the shared MarkdownViewer (same renderer as notes/chat), and
 * that raw HTML in a release body is neutralized by the shared pipeline.
 */
import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// MarkdownViewer reads the active workspace id through a store selector at
// component init; back the store module with the standard mock so the real
// viewer can render without Store.init().
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: { workspace: { activeWorkspaceId: null }, userPreferences: {} },
    dispatch: vi.fn(),
  });
});

import ReleaseNotesModal from '../ReleaseNotesModal.svelte';

const markdownBody = [
  'Intent v2.20.0',
  '',
  '## Desktop app (cloudlands-fe)',
  '',
  '### Features',
  '',
  '- prefer session-advertised `effortLevels` in the effort picker gate ([#847](https://github.com/intent-hq/cloudlands-fe/pull/847))',
  '- gate splash dismissal on backend connected signal ([#846](https://github.com/intent-hq/cloudlands-fe/pull/846))',
  '',
  '## Backend daemon (intentd)',
  '',
  'Bundles [intentd v0.6.1](https://github.com/intent-hq/intentd/releases/tag/v0.6.1).',
].join('\r\n');

function renderModal(notes: string) {
  return render(ReleaseNotesModal, {
    props: {
      open: true,
      releaseNotes: {
        version: '2.20.0',
        notes,
        url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.20.0',
      },
    },
  });
}

describe('ReleaseNotesModal markdown rendering', () => {
  it('renders the release body as HTML, not escaped plain text', async () => {
    renderModal(markdownBody);

    const viewer = await waitFor(() => {
      const el = document.body.querySelector('.markdown-viewer');
      expect(el).not.toBeNull();
      expect(el?.querySelector('h2')).not.toBeNull();
      return el as HTMLElement;
    });

    // Headings render as heading elements, not literal "##" text
    const headings = Array.from(viewer.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(headings).toContain('Desktop app (cloudlands-fe)');
    expect(viewer.querySelector('h3')?.textContent?.trim()).toBe('Features');
    expect(viewer.textContent).not.toContain('##');

    // Bullet lists render as list items
    expect(viewer.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(2);

    // Links render as anchors, not literal [text](url)
    const link = viewer.querySelector(
      'a[href="https://github.com/intent-hq/cloudlands-fe/pull/847"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('#847');
    expect(viewer.textContent).not.toContain('](');

    // Inline code renders as <code>
    expect(viewer.querySelector('code')?.textContent).toBe('effortLevels');
  });

  it('neutralizes raw HTML in the release body', async () => {
    renderModal('## Notes\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>');

    const viewer = await waitFor(() => {
      const el = document.body.querySelector('.markdown-viewer');
      expect(el).not.toBeNull();
      expect(el?.querySelector('h2')).not.toBeNull();
      return el as HTMLElement;
    });

    expect(viewer.querySelector('h2')?.textContent?.trim()).toBe('Notes');
    // Raw HTML is escaped to inert text by the pipeline: no live elements.
    expect(viewer.querySelector('img')).toBeNull();
    expect(viewer.querySelector('script')).toBeNull();
    expect(viewer.querySelector('[onerror]')).toBeNull();
  });
});

describe('Tailwind entry point (monorepo#1748 / monorepo#1875)', () => {
  // Tailwind v4 uses CSS-first config and ignores the legacy
  // tailwind.config.js. The typography plugin's global `prose` styles broke
  // note-editor typography (monorepo#1875), so markdown surfaces render via
  // MarkdownViewer instead and app.css must NOT load the plugin. The
  // class-based dark variant stays — the app toggles `.dark`/`.light` on the
  // root element, so `dark:` variants must key off the class.
  const appCss = readFileSync(path.resolve(__dirname, '../../../../app.css'), 'utf8');

  it('does not load the typography plugin', () => {
    expect(appCss).not.toMatch(/@plugin\s+["']@tailwindcss\/typography["']/);
  });

  it('defines the class-based dark variant', () => {
    expect(appCss).toMatch(/@custom-variant\s+dark\s+/);
  });

  // CSS requires all @import rules to precede every other statement. A
  // directive placed before the `$lib` imports makes them invalid, and Vite
  // silently drops the imported stylesheets (tiptap-editor/chat-messages/
  // comments) from the production bundle (monorepo#1909).
  it('has no non-@import statement before the last @import', () => {
    const lastImportEnd = appCss.lastIndexOf('@import');
    expect(lastImportEnd).toBeGreaterThan(-1);
    const beforeImports = appCss
      .slice(0, appCss.indexOf(';', lastImportEnd) + 1)
      // Strip comments and @import statements; only whitespace may remain.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import\s[^;]*;/g, '');
    expect(beforeImports.trim()).toBe('');
  });
});
