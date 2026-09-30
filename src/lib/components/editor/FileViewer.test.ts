import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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

  it.each(['http://127.0.0.1:3000/preview.mp4', 'https://media.example/preview.mp4'])(
    'renders the direct video URL %s without base64 wrapping',
    (videoUrl) => {
      render(FileViewer, { props: { filePath: 'preview.mp4', fileContent: videoUrl } });

      expect(screen.getByTestId<HTMLVideoElement>('file-video').getAttribute('src')).toBe(videoUrl);
    },
  );
});

describe('FileViewer image panning', () => {
  function setup() {
    const result = render(FileViewer, { props: { filePath: 'photo.png', fileContent: 'AAAA' } });
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'photo.png' });
    const viewport = image.parentElement!;
    const captures = new Set<number>();
    viewport.setPointerCapture = vi.fn((id) => captures.add(id));
    viewport.hasPointerCapture = vi.fn((id) => captures.has(id));
    viewport.releasePointerCapture = vi.fn((id) => captures.delete(id));
    return { ...result, image, viewport };
  }

  function pointer(
    target: Element,
    type: string,
    init: MouseEventInit & { pointerId?: number; isPrimary?: boolean } = {},
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      ...init,
    });
    Object.defineProperties(event, {
      pointerId: { value: init.pointerId ?? 1 },
      isPrimary: { value: init.isPrimary ?? true },
    });
    return fireEvent(target, event);
  }

  it.each(['image', 'background'])(
    'pans from the %s by the pointer distance on both axes',
    async (target) => {
      const { image, viewport } = setup();
      await pointer(target === 'image' ? image : viewport, 'pointerdown', {
        clientX: 100,
        clientY: 90,
      });
      await pointer(viewport, 'pointermove', { clientX: 140, clientY: 65 });
      expect(image.style.translate).toBe('40px -25px');
      expect(viewport.setPointerCapture).toHaveBeenCalledWith(1);
      expect(image.draggable).toBe(false);
    },
  );

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
    'stops panning on %s and allows a new drag',
    async (type) => {
      const { image, viewport } = setup();
      await pointer(viewport, 'pointerdown');
      await pointer(viewport, 'pointermove', { clientX: 30, clientY: 20 });
      await pointer(viewport, type);
      await pointer(viewport, 'pointermove', { clientX: 80, clientY: 70 });
      expect(image.style.translate).toBe('30px 20px');
      expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
      await pointer(viewport, 'pointerdown', { clientX: 80, clientY: 70 });
      await pointer(viewport, 'pointermove', { clientX: 90, clientY: 80 });
      expect(image.style.translate).toBe('40px 30px');
    },
  );

  it.each([{ button: 1 }, { button: 2 }, { isPrimary: false }])(
    'ignores non-primary input %j',
    async (init) => {
      const { image, viewport } = setup();
      await pointer(viewport, 'pointerdown', init);
      await pointer(viewport, 'pointermove', { clientX: 30 });
      expect(image.style.translate).toBe('0px 0px');
      expect(viewport.setPointerCapture).not.toHaveBeenCalled();
    },
  );

  it('ignores other pointers during a drag', async () => {
    const { image, viewport } = setup();
    await pointer(viewport, 'pointerdown');
    await pointer(viewport, 'pointerdown', { pointerId: 2, clientX: 100 });
    await pointer(viewport, 'pointermove', { pointerId: 2, clientX: 200 });
    await pointer(viewport, 'pointerup', { pointerId: 2 });
    await pointer(viewport, 'pointermove', { clientX: 20, clientY: 10 });
    expect(image.style.translate).toBe('20px 10px');
  });

  it('ends a drag on window blur or when the primary button is no longer held', async () => {
    const { image, viewport } = setup();
    await pointer(viewport, 'pointerdown');
    await fireEvent(window, new Event('blur'));
    await pointer(viewport, 'pointermove', { clientX: 40 });
    expect(image.style.translate).toBe('0px 0px');
    await pointer(viewport, 'pointerdown');
    await pointer(viewport, 'pointermove', { clientX: 40, buttons: 0 });
    await pointer(viewport, 'pointermove', { clientX: 80 });
    expect(image.style.translate).toBe('0px 0px');
  });

  it('resets panning and capture when switching files and releases capture on unmount', async () => {
    const { image, viewport, rerender, unmount } = setup();
    await pointer(viewport, 'pointerdown');
    await pointer(viewport, 'pointermove', { clientX: 30, clientY: 20 });
    await rerender({ filePath: 'next.png', fileContent: 'BBBB' });
    await pointer(viewport, 'pointermove', { clientX: 80 });
    expect(image.style.translate).toBe('0px 0px');
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
    await pointer(viewport, 'pointerdown', { pointerId: 2 });
    unmount();
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(2);
  });

  it('keeps translation independent of zoom and rotation and leaves wheel events alone', async () => {
    const { image, viewport } = setup();
    await fireEvent.click(screen.getByTitle('Zoom in'));
    await fireEvent.click(screen.getByTitle('Rotate'));
    await pointer(viewport, 'pointerdown');
    await pointer(viewport, 'pointermove', { clientX: 40, clientY: 20 });
    expect(image.style.translate).toBe('40px 20px');
    expect(image.style.transform).toBe('scale(1.25) rotate(90deg)');
    await pointer(viewport, 'pointerup');
    await fireEvent.click(screen.getByTitle('Zoom out'));
    expect(image.style.transform).toBe('scale(1) rotate(90deg)');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    await fireEvent(viewport, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(image.style.translate).toBe('40px 20px');
  });
});
