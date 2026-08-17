/**
 * @vitest-environment jsdom
 *
 * Tests for ReleaseNotesModal.
 *
 * Regression coverage for markdown rendering (intent-hq/monorepo#1748,
 * intent-hq/monorepo#1875): mounts the real modal with a markdown release
 * body and asserts the notes render as HTML (headings, lists, links, inline
 * code) — not as escaped plain text — via the shared MarkdownViewer (same
 * renderer as notes/chat), and that raw HTML in a release body is neutralized
 * by the shared pipeline.
 *
 * Redesigned-dialog coverage: leading "Intent vX.Y.Z" version-line stripping
 * (matching + non-matching), the scoped release-notes container classes,
 * footer buttons, and the loading / unavailable fallbacks.
 */
import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { m } from '$shared/paraglide/messages.js';

// MarkdownViewer reads the active workspace id through a store selector at
// component init; back the store module with the standard mock so the real
// viewer can render without Store.init().
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: { userPreferences: {}, tabState: { currentTabId: null } },
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

function renderModal(notes: string, { version = '2.20.0', loading = false } = {}) {
  return render(ReleaseNotesModal, {
    props: {
      open: true,
      loading,
      releaseNotes: {
        version,
        notes,
        url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.20.0',
      },
    },
  });
}

async function waitForViewer(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.body.querySelector('.markdown-viewer');
    expect(el).not.toBeNull();
    expect(el?.querySelector('h2')).not.toBeNull();
    return el as HTMLElement;
  });
}

describe('ReleaseNotesModal markdown rendering', () => {
  it('renders the release body as HTML, not escaped plain text', async () => {
    renderModal(markdownBody);

    const viewer = await waitForViewer();

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

    const viewer = await waitForViewer();

    expect(viewer.querySelector('h2')?.textContent?.trim()).toBe('Notes');
    // Raw HTML is escaped to inert text by the pipeline: no live elements.
    expect(viewer.querySelector('img')).toBeNull();
    expect(viewer.querySelector('script')).toBeNull();
    expect(viewer.querySelector('[onerror]')).toBeNull();
  });
});

describe('ReleaseNotesModal redesigned dialog', () => {
  it('strips the leading version line when it matches the release version', async () => {
    renderModal(markdownBody); // first body line is "Intent v2.20.0", version 2.20.0

    const viewer = await waitForViewer();

    expect(viewer.textContent).not.toContain('Intent v2.20.0');
    // The rest of the body still renders fully.
    expect(viewer.querySelector('h2')?.textContent?.trim()).toBe('Desktop app (cloudlands-fe)');
    expect(viewer.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the leading version line when it does not match the release version', async () => {
    renderModal(markdownBody, { version: '2.21.0' });

    const viewer = await waitForViewer();

    expect(viewer.textContent).toContain('Intent v2.20.0');
  });

  it('renders bodies without a version line untouched', async () => {
    renderModal('## Notes\n\n- something changed');

    const viewer = await waitForViewer();

    expect(viewer.querySelector('h2')?.textContent?.trim()).toBe('Notes');
    expect(viewer.textContent).toContain('something changed');
  });

  it('renders the scoped release-notes container classes', async () => {
    renderModal(markdownBody);

    await waitForViewer();

    expect(document.body.querySelector('.release-notes-dialog')).not.toBeNull();
    const body = document.body.querySelector('.release-notes-body');
    expect(body).not.toBeNull();
    // The markdown body renders inside the scoped container.
    expect(body?.querySelector('.markdown-viewer')).not.toBeNull();
  });

  it('renders the footer buttons', async () => {
    renderModal(markdownBody);

    await waitForViewer();

    const labels = Array.from(document.body.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain(m.releaseNotes_modal_viewOnGitHub_label());
    expect(labels).toContain(m.releaseNotes_modal_dismiss_label());
  });

  it('shows the loading message while loading', async () => {
    renderModal(markdownBody, { loading: true });

    await waitFor(() => {
      expect(document.body.textContent).toContain(m.releaseNotes_modal_loading_message());
    });
    expect(document.body.querySelector('.markdown-viewer')).toBeNull();
  });

  it('shows the unavailable fallback when there are no notes', async () => {
    render(ReleaseNotesModal, { props: { open: true, releaseNotes: null } });

    await waitFor(() => {
      expect(document.body.textContent).toContain(m.releaseNotes_modal_unavailable_message());
    });
    // The dismiss button still renders so the dialog can be closed.
    const labels = Array.from(document.body.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain(m.releaseNotes_modal_dismiss_label());
  });
});

describe('Tailwind entry point (monorepo#1748 / monorepo#1875)', () => {
  // Tailwind v4 uses CSS-first config and ignores the legacy
  // tailwind.config.js. MarkdownViewer uses the typography plugin's generated
  // `prose` classes, so the CSS-first entry point must load it explicitly. The
  // class-based dark variant stays — the app toggles `.dark`/`.light` on the
  // root element, so `dark:` variants must key off the class.
  const appCss = readFileSync(path.resolve(__dirname, '../../../../app.css'), 'utf8');

  it('loads the typography plugin from the CSS-first entry point', () => {
    expect(appCss).toMatch(/@plugin\s+["']@tailwindcss\/typography["']/);
  });

  it('defines the class-based dark variant', () => {
    expect(appCss).toMatch(/@custom-variant\s+dark\s+/);
  });

  // CSS requires all @import rules to precede every other statement. A
  // directive placed before the `$lib` imports makes them invalid, and Vite
  // silently drops the imported stylesheets (tiptap-editor/chat-messages/
  // comments) from the production bundle (monorepo#1909).
  it('has no non-@import statement before the last @import', () => {
    // Strip comments first so `@import` inside a comment can't skew the scan.
    const withoutComments = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
    // The three `$lib` stylesheets must be imported at all.
    expect(withoutComments.match(/@import\s[^;]*;/g)?.length).toBeGreaterThanOrEqual(4);
    const lastImportStart = withoutComments.lastIndexOf('@import');
    const lastImportEnd = withoutComments.indexOf(';', lastImportStart);
    expect(lastImportEnd).toBeGreaterThan(lastImportStart);
    // Everything before the last @import must be @imports and whitespace only.
    const beforeImports = withoutComments
      .slice(0, lastImportEnd + 1)
      .replace(/@import\s[^;]*;/g, '');
    expect(beforeImports.trim()).toBe('');
  });
});
