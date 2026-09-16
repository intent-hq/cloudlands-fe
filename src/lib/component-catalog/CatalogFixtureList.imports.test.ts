/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { getCatalogEntry } from './catalog';
import CatalogFixtureList from './CatalogFixtureList.svelte';

const imports = vi.hoisted(() => ({ preview: vi.fn(), controls: vi.fn() }));
vi.mock('./renderers/ChatPolishCatalogPreview.svelte', () => {
  imports.preview();
  return { default: () => {} };
});
vi.mock('./ChatPolishGeometryControls.svelte', () => {
  imports.controls();
  return { default: () => {} };
});

afterEach(cleanup);

it('does not evaluate hidden chat preview imports in gallery mode', async () => {
  const view = render(CatalogFixtureList, {
    props: { entry: getCatalogEntry('chat-polish')!, mode: 'gallery' },
  });
  await vi.dynamicImportSettled();
  expect(screen.getByRole('link', { name: 'Focus view' })).toBeTruthy();
  expect(screen.queryByTestId('chat-polish-sidebar')).toBeNull();
  expect(imports.preview).not.toHaveBeenCalled();
  expect(imports.controls).not.toHaveBeenCalled();

  await view.rerender({ entry: getCatalogEntry('chat-polish')!, mode: 'detail' });
  await vi.dynamicImportSettled();
  expect(imports.preview).toHaveBeenCalledTimes(1);
  expect(imports.controls).toHaveBeenCalledTimes(1);
});
