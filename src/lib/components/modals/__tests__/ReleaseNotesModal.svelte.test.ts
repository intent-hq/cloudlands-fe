/**
 * @vitest-environment jsdom
 *
 * Regression tests for ReleaseNotesModal markdown rendering
 * (intent-hq/monorepo#1748).
 *
 * Mounts the real modal with a markdown release body and asserts the notes
 * render as HTML (headings, lists, links, inline code) — not as escaped plain
 * text — inside the shared `prose` container, and that raw HTML in a release
 * body is sanitized away by the marked + DOMPurify pipeline.
 */
import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

    const prose = await waitFor(() => {
      const el = document.body.querySelector('.prose');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // Headings render as heading elements, not literal "##" text
    const headings = Array.from(prose.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(headings).toContain('Desktop app (cloudlands-fe)');
    expect(prose.querySelector('h3')?.textContent?.trim()).toBe('Features');
    expect(prose.textContent).not.toContain('##');

    // Bullet lists render as list items
    expect(prose.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(2);

    // Links render as anchors, not literal [text](url)
    const link = prose.querySelector(
      'a[href="https://github.com/intent-hq/cloudlands-fe/pull/847"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('#847');
    expect(prose.textContent).not.toContain('](');

    // Inline code renders as <code>
    expect(prose.querySelector('code')?.textContent).toBe('effortLevels');
  });

  it('neutralizes raw HTML in the release body', async () => {
    renderModal('## Notes\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>');

    const prose = await waitFor(() => {
      const el = document.body.querySelector('.prose');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(prose.querySelector('h2')?.textContent?.trim()).toBe('Notes');
    // Raw HTML is escaped to inert text by the pipeline: no live elements.
    expect(prose.querySelector('img')).toBeNull();
    expect(prose.querySelector('script')).toBeNull();
    expect(prose.querySelector('[onerror]')).toBeNull();
  });
});

describe('Tailwind entry point (monorepo#1748 root cause)', () => {
  // Tailwind v4 uses CSS-first config and ignores the legacy
  // tailwind.config.js, so `prose` styling only exists if app.css loads the
  // typography plugin itself. The jsdom tests above pass without any CSS, so
  // guard the directives at the source level: removing either one silently
  // reverts the app to unstyled markdown / media-query dark variants.
  const appCss = readFileSync(path.resolve(__dirname, '../../../../app.css'), 'utf8');

  it('loads the typography plugin via @plugin', () => {
    expect(appCss).toMatch(/@plugin\s+["']@tailwindcss\/typography["'];/);
  });

  it('defines the class-based dark variant', () => {
    expect(appCss).toMatch(/@custom-variant\s+dark\s+/);
  });
});
