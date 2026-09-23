/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Preview from '../image-sharing.preview.svelte';

vi.mock('../image-sharing.preview-fixtures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../image-sharing.preview-fixtures')>()),
  // jsdom cannot paint canvas; the real components still receive a valid fixture data URL.
  createImageSharingRaster: () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
}));

afterEach(() => cleanup());

describe('image-sharing preview interactions', () => {
  it.each(['thumbnail-only', 'truncated'] as const)(
    'hydrates %s before offering original actions',
    async (scene) => {
      render(Preview, { props: { scene } });
      expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
      await fireEvent.click(await screen.findByRole('button', { name: /load full-size/i }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();

      await fireEvent.click(screen.getByRole('button', { name: /finish simulated load/i }));
      expect(await screen.findByRole('button', { name: /image options/i })).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: /view .* full size/i }));
      expect(await screen.findByRole('dialog', { name: /image preview/i })).toBeTruthy();
    },
  );

  it.each(['https', 'download-failure'] as const)(
    'blocks %s images until the local route is explicitly installed',
    async (scene) => {
      render(Preview, { props: { scene } });
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
    },
  );
});
