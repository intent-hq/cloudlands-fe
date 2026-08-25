import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));

import FileViewer from './FileViewer.svelte';

afterEach(cleanup);

function decodeSvgSource(source: string): string {
  const prefix = 'data:image/svg+xml;base64,';
  expect(source.startsWith(prefix)).toBe(true);
  return new TextDecoder().decode(
    Uint8Array.from(atob(source.slice(prefix.length)), (character) => character.charCodeAt(0)),
  );
}

describe('FileViewer SVG preview', () => {
  it('renders an ordinary SVG as a contained vector image', () => {
    const content =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><text>Intent ✓</text></svg>';

    render(FileViewer, { props: { filePath: 'assets/brand.svg', fileContent: content } });

    const preview = screen.getByRole<HTMLImageElement>('img', { name: 'brand.svg' });
    expect(decodeSvgSource(preview.getAttribute('src') ?? '')).toBe(content);
    expect(preview.classList.contains('max-w-full')).toBe(true);
    expect(preview.classList.contains('max-h-full')).toBe(true);
    expect(screen.getByText('brand.svg')).toBeTruthy();
  });

  it('keeps SVG scripts and event handlers outside the renderer DOM', () => {
    const content = `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__svgPreviewExecuted()">
      <script>window.__svgPreviewExecuted()</script>
      <rect onclick="window.__svgPreviewExecuted()" width="10" height="10" />
    </svg>`;

    const { container } = render(FileViewer, {
      props: { filePath: 'untrusted.svg', fileContent: content },
    });
    const preview = screen.getByRole<HTMLImageElement>('img', { name: 'untrusted.svg' });
    const previewSurface = preview.parentElement;

    expect(container.contains(previewSurface)).toBe(true);
    expect(previewSurface?.querySelector('svg')).toBeNull();
    expect(previewSurface?.querySelector('script')).toBeNull();
    expect(previewSurface?.querySelector('[onload], [onclick]')).toBeNull();
    expect(preview.getAttributeNames().sort()).toEqual(['alt', 'class', 'src']);
    expect(decodeSvgSource(preview.getAttribute('src') ?? '')).toBe(content);
  });
});

describe('FileViewer workspace media', () => {
  it('renders an image from the contained workspace-file source', () => {
    const sourceUrl = 'workspace-file://ws-1/.demo-artifacts/run/preview.png';
    render(FileViewer, {
      props: { filePath: '.demo-artifacts/run/preview.png', sourceUrl },
    });

    expect(
      screen.getByRole<HTMLImageElement>('img', { name: 'preview.png' }).getAttribute('src'),
    ).toBe(sourceUrl);
  });

  it.each([
    ['preview.mp4', 'video/mp4'],
    ['preview.webm', 'video/webm'],
  ])('renders %s with a correct video fallback MIME type', (filePath, mimeType) => {
    render(FileViewer, { props: { filePath, fileContent: 'AAAA', isBinary: true } });

    const video = screen.getByTestId<HTMLVideoElement>('file-video');
    expect(video.getAttribute('src')).toBe(`data:${mimeType};base64,AAAA`);
    expect(video.getAttribute('src')).not.toContain('data:image/');
    expect(video.preload).toBe('metadata');
    expect(video.autoplay).toBe(false);
  });

  it('renders a workspace WebM URL directly for ranged playback', () => {
    const sourceUrl = 'workspace-file://ws-1/.demo-artifacts/run/preview.webm';
    render(FileViewer, { props: { filePath: 'preview.webm', sourceUrl } });

    expect(screen.getByTestId<HTMLVideoElement>('file-video').getAttribute('src')).toBe(sourceUrl);
  });
});
