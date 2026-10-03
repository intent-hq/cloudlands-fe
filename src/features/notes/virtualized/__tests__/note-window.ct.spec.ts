import { test, expect } from '../../../../test/ct-test';
import Harness from './NoteWindowHarness.svelte';

test('opens and far-seeks a multimegabyte note with bounded source, native nodes and requests', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness);
  const root = page.getByTestId('reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  const first = await root.evaluate((e: any) => e.read());
  expect(first.sourceLength).toBeGreaterThan(3_000_000);
  expect(first.cost.sourceBytes).toBeLessThanOrEqual(8192);
  expect(first.mounted).toBe(1);
  expect(first.pmNodes).toBeLessThan(4096);
  expect(first.requests).toBeLessThanOrEqual(32);
  await root.evaluate((e: any) => e.view.reveal(2_000_000));
  await expect
    .poll(() => root.evaluate((e: any) => e.read().range.start))
    .toBeGreaterThan(1_990_000);
  const next = await root.evaluate((e: any) => e.read());
  expect(next.requests - first.requests).toBeLessThanOrEqual(32);
  expect(next.cost.mountedViews).toBe(1);
  expect(next.cost.destroyedViews).toBeGreaterThan(0);
  expect(next.maxOutstanding).toBe(1);
  expect(next.lastError).toBe('');
  await expect
    .poll(() =>
      root.evaluate((e: any) => {
        const g = e.geometry(2_000_000);
        return g.top >= g.viewportTop && g.bottom <= g.viewportBottom;
      }),
    )
    .toBe(true);
  await component.unmount();
});

test('retains the active native view while composition is pinned, then releases the queued window', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const root = page.getByTestId('reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  await root.evaluate((e: any) => {
    e.original = e.view.editor;
    e.view.host.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: 'に' }),
    );
  });
  await root.evaluate((e: any) => e.load(1_000_000));
  expect(
    await root.evaluate((e: any) => ({
      same: e.original === e.view.editor,
      destroyed: e.original.isDestroyed,
      pending: e.view.cost.pendingBytes,
    })),
  ).toMatchObject({ same: true, destroyed: false });
  expect(await root.evaluate((e: any) => e.view.cost.pendingBytes)).toBeGreaterThan(0);
  await root.evaluate((e: any) =>
    e.view.host.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'に' }),
    ),
  );
  await expect.poll(() => root.evaluate((e: any) => e.read().range.start)).toBeGreaterThan(990_000);
  expect(await root.evaluate((e: any) => e.original.isDestroyed)).toBe(true);
});

test('physical scrolling loads another bounded window and keeps source near the viewport', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const root = page.getByTestId('reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  const before = await root.evaluate((e: any) => e.read());
  await page.getByTestId('reading-scroller').hover();
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => root.evaluate((e: any) => e.read().range.start)).toBeGreaterThan(0);
  const after = await root.evaluate((e: any) => e.read());
  expect(after.requests - before.requests).toBeLessThanOrEqual(64);
  expect(after.cost.sourceBytes).toBeLessThanOrEqual(8192);
  expect(after.mounted).toBe(1);
  const bounds = await root.evaluate((e: any) => {
    const r = e.view.host.getBoundingClientRect(),
      s = e.view.scroller.getBoundingClientRect();
    return { visible: r.bottom > s.top && r.top < s.bottom };
  });
  expect(bounds.visible).toBe(true);
});

test('select all and copy retain full-document endpoints without fetching the document', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const root = page.getByTestId('reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  const before = await root.evaluate((e: any) => e.read());
  await root.evaluate((e: any) => {
    e.view.host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    e.view.host.dispatchEvent(copy);
    e.copyPrevented = copy.defaultPrevented;
  });
  const after = await root.evaluate((e: any) => ({
    ...e.read(),
    selection: e.view.getSelection(),
    copyPrevented: e.copyPrevented,
  }));
  expect(after.selection).toMatchObject({ anchor: 0, head: before.sourceLength });
  expect(after.fullOperations).toEqual(['selectAll', 'copy']);
  expect(after.copyPrevented).toBe(true);
  expect(after.requests).toBe(before.requests);
});

test('source selection across unloaded text mounts only the destination and preserves its anchor', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const root = page.getByTestId('reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  const before = await root.evaluate((e: any) => e.read());
  await root.evaluate((e: any) =>
    e.view.setSelection({ anchor: 25, head: 2_000_000, anchorAffinity: 1, headAffinity: 1 }),
  );
  await expect
    .poll(() => root.evaluate((e: any) => e.read().range.start))
    .toBeGreaterThan(1_990_000);
  const after = await root.evaluate((e: any) => ({
    ...e.read(),
    selection: e.view.getSelection(),
  }));
  expect(after.selection).toMatchObject({ anchor: 25, head: 2_000_000 });
  expect(after.requests - before.requests).toBeLessThanOrEqual(32);
  expect(after.mounted).toBe(1);
});

test('keeps a visible source anchor in place when the renderer width changes', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness);
  const root = page.getByTestId('reading-harness');
  await expect(root).toHaveAttribute('data-status', 'ready');
  await root.evaluate((e: any) => e.view.reveal(2_000_000));
  await expect
    .poll(() => root.evaluate((e: any) => e.read().range.start))
    .toBeGreaterThan(1_990_000);
  const before = await root.evaluate((e: any) => ({
    ...e.geometry(2_000_000),
    height: e.view.host.getBoundingClientRect().height,
  }));
  await page.getByTestId('reading-scroller').evaluate((e) => (e.style.width = '440px'));
  await expect
    .poll(() => root.evaluate((e: any) => e.view.host.getBoundingClientRect().height))
    .toBeGreaterThan(before.height);
  await expect
    .poll(() =>
      root.evaluate((e: any, top) => Math.abs(e.geometry(2_000_000).top - top), before.top),
    )
    .toBeLessThan(3);
  const after = await root.evaluate((e: any) => e.geometry(2_000_000));
  expect(Math.abs(after.top - before.top)).toBeLessThan(3);
  await testInfo.attach('visible-source-anchor', {
    body: await page.getByTestId('reading-scroller').screenshot(),
    contentType: 'image/png',
  });
});
