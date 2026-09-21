import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import Button from '../components/ui/button/button.svelte';
import { preview as buttonPreview } from '../components/ui/button/button.preview.svelte';
import CatalogWidth from './CatalogWidth.test.svelte';

vi.mock('$app/state', () => ({
  page: {
    params: { slug: 'button' },
    url: new URL('http://localhost/sandbox/button?state=default&width=680'),
  },
}));
vi.mock('./preview-discovery', () => ({
  loadPreview: async () => ({ component: Button, definition: buttonPreview }),
  setActivePreview: vi.fn(),
  installPreviewBrowserApi: () => () => {},
}));
vi.mock('./capture-stability', () => ({
  waitForCaptureStability: async () => ({ reducedMotion: true }),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it('updates a named scene and URL when the shell width control changes without reloading', async () => {
  window.history.replaceState(null, '', '/sandbox/button?state=default&width=680');
  render(CatalogWidth);
  await waitFor(() => expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('680px'));

  const scene = screen.getByTestId('catalog-scene');
  const widthControl = screen.getByRole('combobox', { name: 'Preview', exact: true });
  await fireEvent.keyDown(widthControl, { key: 'Enter' });
  await fireEvent.keyDown(widthControl, { key: 'Home' });
  await fireEvent.keyDown(widthControl, { key: 'ArrowDown' });
  await fireEvent.keyDown(widthControl, { key: 'Enter' });

  await waitFor(() => expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('320px'));
  expect(screen.getByTestId('catalog-scene')).toBe(scene);
  expect(new URL(window.location.href).searchParams.get('width')).toBe('320');
  expect(new URL(window.location.href).searchParams.get('state')).toBe('default');

  await fireEvent.keyDown(widthControl, { key: 'Enter' });
  await fireEvent.keyDown(widthControl, { key: 'Home' });
  await fireEvent.keyDown(widthControl, { key: 'Enter' });
  await waitFor(() => expect(screen.getByTestId('catalog-scene-focus').style.width).toBe('720px'));
  expect(new URL(window.location.href).searchParams.has('width')).toBe(false);
});
