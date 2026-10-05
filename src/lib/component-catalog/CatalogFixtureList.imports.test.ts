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

it('loads chat preview imports only when navigating to its entry', async () => {
  const view = render(CatalogFixtureList, {
    props: { entry: getCatalogEntry('button')! },
  });
  await vi.dynamicImportSettled();
  expect(screen.queryByTestId('chat-polish-sidebar')).toBeNull();
  expect(imports.preview).not.toHaveBeenCalled();
  expect(imports.controls).not.toHaveBeenCalled();

  await view.rerender({ entry: getCatalogEntry('chat-polish')! });
  await vi.dynamicImportSettled();
  expect(imports.preview).toHaveBeenCalledTimes(1);
  expect(imports.controls).toHaveBeenCalledTimes(1);
});
