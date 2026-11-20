import { writeFile } from 'node:fs/promises';
import { expect, test, wheelUntilScrolled } from '../../../test/ct-test';
import Harness from './__tests__/DockRecencyBrowserHarness.svelte';

for (const unavailable of [false, true]) {
  test(`dock production recency boundary: ${unavailable ? 'unavailable index' : 'human conversations'}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 760 });
    await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
    await mount(Harness, { props: { unavailable } });
    const host = page.getByTestId('dock-recency-boundary');
    const requests = async (): Promise<
      Array<{
        method: string;
        params: { scope?: string; previewChars?: number; workspaceId?: string; limit?: number };
      }>
    > => JSON.parse((await host.getAttribute('data-requests'))!);
    await expect
      .poll(
        async () =>
          (await requests()).filter(({ method }) => method === 'agent.listUserMessages').length,
      )
      .toBe(7);
    const expectedIds = unavailable
      ? []
      : ['dock-preview-workspace-52', 'dock-preview-workspace-51', 'dock-preview-workspace-53'];
    await expect(host).toHaveAttribute('data-visible-ids', JSON.stringify(expectedIds));
    await expect(host.locator('button[data-workspace-id]')).toHaveCount(expectedIds.length);
    const assistant = host.locator('[data-dock-assistant]');
    await assistant.focus();
    await expect(assistant).toBeVisible();
    const calls = await requests();
    expect(
      new Set(
        calls.filter(({ method }) => method === 'agent.list').map(({ params }) => params.scope),
      ),
    ).toEqual(new Set(['topLevel', 'delegated', 'background']));
    for (const { params } of calls.filter(({ method }) => method === 'agent.listUserMessages')) {
      expect(params.workspaceId).toBeTruthy();
      expect(params.previewChars).toBe(80);
      expect(params.limit).toBe(50);
    }
    await testInfo.attach('dock-recency-boundary.json', {
      body: JSON.stringify(
        {
          clock: '2026-10-19T12:00:00.000Z',
          unavailable,
          visibleWorkspaceIds: expectedIds,
          requests: calls,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    const screenshot = testInfo.outputPath('dock-recency-boundary.png');
    await host.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('dock-recency-boundary.png', {
      path: screenshot,
      contentType: 'image/png',
    });
  });
}

for (const mode of ['floating-down', 'floating-up', 'notch'] as const) {
  test(`older workspace disclosure in ${mode} shows three then five complete rows`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 720, height: 960 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
    const component = await mount(Harness, { props: { allOld: true, total: 8, mode } });
    const host = page.getByTestId('dock-recency-boundary');
    await expect
      .poll(
        async () =>
          JSON.parse((await host.getAttribute('data-requests'))!).filter(
            (x: { method: string }) => x.method === 'agent.listUserMessages',
          ).length,
      )
      .toBe(8);
    await component.getByTestId('dock-drag-handle').hover();
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    const surface = component.locator('section[data-dock-surface]');
    const before = info.outputPath(`${mode}-before.png`);
    await surface.screenshot({ path: before });
    await info.attach(`${mode} default older list — browser component`, {
      path: before,
      contentType: 'image/png',
    });
    const rows = component.locator(
      '[data-dock-row][data-workspace-id]:not([data-workspace-id="dock:assistant"])',
    );
    await expect(rows).toHaveCount(3);
    await expect(host).toHaveAttribute(
      'data-visible-ids',
      JSON.stringify(['old-human-1', 'old-human-2', 'old-human-3']),
    );
    const disclosure = component.getByRole('button', { name: 'Show older', exact: true });
    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(rows).toHaveCount(8);
    await expect(disclosure).toHaveCount(0);
    await expect(rows.nth(3)).toBeFocused();
    // The focus transfer must not leave the viewport scrolled past its first full row.
    const scroller = component.locator('[data-dock-scroll]');
    await surface.screenshot({ path: info.outputPath(`${mode}-expanded-measurement.png`) });
    await writeFile(
      info.outputPath(`${mode}-row-geometry.json`),
      JSON.stringify(
        await rows.evaluateAll((elements) => {
          const viewport = elements[0].closest<HTMLElement>('[data-dock-scroll]')!;
          const clip = viewport.getBoundingClientRect();
          return {
            scrollTop: viewport.scrollTop,
            clientHeight: viewport.clientHeight,
            viewport: { top: clip.top, bottom: clip.bottom, height: clip.height },
            rows: elements.map((el) => {
              const r = el.getBoundingClientRect();
              return {
                id: el.getAttribute('data-workspace-id'),
                top: r.top,
                bottom: r.bottom,
                height: r.height,
              };
            }),
          };
        }),
        null,
        2,
      ),
    );
    await expect
      .poll(() =>
        rows.evaluateAll((elements) => {
          const viewport = elements[0].closest('[data-dock-scroll]')!.getBoundingClientRect();
          return elements.slice(0, 5).every((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= viewport.top - 1 && r.bottom <= viewport.bottom + 1;
          });
        }),
      )
      .toBe(true);
    const assistant = component.locator('[data-workspace-id="dock:assistant"]');
    await expect(assistant).toBeInViewport();
    const assistantTop = await assistant.evaluate((el) => el.getBoundingClientRect().top);
    const after = info.outputPath(`${mode}-after.png`);
    await surface.screenshot({ path: after });
    await info.attach(`${mode} expanded older list — browser component`, {
      path: after,
      contentType: 'image/png',
    });
    await wheelUntilScrolled(scroller, { deltaY: 600 });
    await rows.last().focus();
    await expect(rows.last()).toBeInViewport();
    await expect(assistant).toBeInViewport();
    expect(
      Math.abs((await assistant.evaluate((el) => el.getBoundingClientRect().top)) - assistantTop),
    ).toBeLessThan(0.5);
    const bottom = info.outputPath(`${mode}-bottom.png`);
    await surface.screenshot({ path: bottom });
    await info.attach(`${mode} scrolled older list — browser component`, {
      path: bottom,
      contentType: 'image/png',
    });
    const ids = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-workspace-id')),
    );
    expect(ids).toEqual(Array.from({ length: 8 }, (_, i) => `old-human-${i + 1}`));
    expect(new Set(ids).size).toBe(8);
    await writeFile(
      info.outputPath(`${mode}-receipt.json`),
      JSON.stringify(
        {
          mode,
          clock: '2026-10-19T12:00:00.000Z',
          ids,
          defaultCount: 3,
          completeExpandedRows: 5,
          assistantFixed: true,
          native: 'mocked geometry boundary; actual browser component',
        },
        null,
        2,
      ),
    );
  });
}

for (const total of [1, 2, 3]) {
  test(`small confirmed-human list with ${total} older workspaces needs no disclosure`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
    const component = await mount(Harness, { props: { allOld: true, total, mode: 'notch' } });
    const host = page.getByTestId('dock-recency-boundary');
    await expect(host).toHaveAttribute(
      'data-visible-ids',
      JSON.stringify(Array.from({ length: total }, (_, i) => `old-human-${i + 1}`)),
    );
    await component.getByTestId('dock-drag-handle').hover();
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    const rows = component.locator(
      '[data-dock-row][data-workspace-id]:not([data-workspace-id="dock:assistant"])',
    );
    await expect(rows).toHaveCount(total);
    await expect(component.getByRole('button', { name: 'Show older', exact: true })).toHaveCount(0);
    for (const row of await rows.all()) await expect(row).toBeInViewport();
  });
}

test('older workspace search includes undisclosed history without duplicates and keeps the keyboard', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
  const component = await mount(Harness, { props: { allOld: true, total: 8, mode: 'notch' } });
  await expect(page.getByTestId('dock-recency-boundary')).toHaveAttribute(
    'data-visible-ids',
    '["old-human-1","old-human-2","old-human-3"]',
  );
  await component.getByTestId('dock-drag-handle').hover();
  const search = component.getByRole('combobox', { name: 'Search workspaces', exact: true });
  await search.fill('workspace 8');
  const rows = component.locator(
    '[data-dock-row][data-workspace-id]:not([data-workspace-id="dock:assistant"])',
  );
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute('data-workspace-id', 'old-human-8');
  await search.press('ArrowDown');
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(rows).toHaveCount(3);
  await expect(search).toBeFocused();
  await component.getByRole('button', { name: 'Show older', exact: true }).click();
  await expect(rows).toHaveCount(8);
  await search.fill('workspace 8');
  await expect(rows).toHaveCount(1);
  await search.fill('');
  await expect(rows).toHaveCount(8);
});

test('older workspace disclosure respects a constrained native work area and scrolls instead', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
  const component = await mount(Harness, {
    props: { allOld: true, total: 8, mode: 'floating-down', smallWorkArea: true },
  });
  await expect(page.getByTestId('dock-recency-boundary')).toHaveAttribute(
    'data-visible-ids',
    '["old-human-1","old-human-2","old-human-3"]',
  );
  await component.getByTestId('dock-drag-handle').hover();
  await component.getByRole('button', { name: 'Show older', exact: true }).click();
  const surface = component.locator('section[data-dock-surface]');
  const assistant = component.locator('[data-workspace-id="dock:assistant"]');
  await expect(assistant).toBeInViewport();
  await expect
    .poll(() =>
      surface.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const display = el
          .closest('[data-dock-rail-preview]')!
          .parentElement!.getBoundingClientRect();
        return r.top >= display.top - 1 && r.bottom <= display.top + 300 + 1;
      }),
    )
    .toBe(true);
  const scroller = component.locator('[data-dock-scroll]');
  await wheelUntilScrolled(scroller, { deltaY: 600 });
  const last = component.locator('[data-workspace-id="old-human-8"]');
  await last.focus();
  await expect(last).toBeInViewport();
});

test('four older workspaces expand to four complete rows', async ({ mount, page }, info) => {
  await page.setViewportSize({ width: 720, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
  const component = await mount(Harness, { props: { allOld: true, total: 4, mode: 'notch' } });
  await expect(page.getByTestId('dock-recency-boundary')).toHaveAttribute(
    'data-visible-ids',
    '["old-human-1","old-human-2","old-human-3"]',
  );
  await component.getByTestId('dock-drag-handle').hover();
  await component.getByRole('button', { name: 'Show older', exact: true }).click();
  const rows = component.locator(
    '[data-dock-row][data-workspace-id]:not([data-workspace-id="dock:assistant"])',
  );
  await expect(rows).toHaveCount(4);
  await component
    .locator('section[data-dock-surface]')
    .screenshot({ path: info.outputPath('four-rows-expanded.png') });
  await writeFile(
    info.outputPath('four-row-geometry.json'),
    JSON.stringify(
      await rows.evaluateAll((elements) => {
        const viewport = elements[0].closest<HTMLElement>('[data-dock-scroll]')!;
        const clip = viewport.getBoundingClientRect();
        const overview = viewport.closest('[data-testid="dock-overview"]')!;
        const measure = (element: Element) => {
          const r = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            height: r.height,
            display: style.display,
            lineHeight: style.lineHeight,
            verticalAlign: style.verticalAlign,
            borderTop: style.borderTopWidth,
            borderBottom: style.borderBottomWidth,
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom,
          };
        };
        return {
          assistantWrapper: measure(overview.querySelector('.assistant-row')!),
          assistantButton: measure(overview.querySelector('[data-workspace-id="dock:assistant"]')!),
          frame: measure(overview.closest('.overview-frame')!),
          search: measure(overview.querySelector('.overview-search')!),
          divider: measure(overview.querySelector('.assistant-divider')!),
          scrollTop: viewport.scrollTop,
          clientHeight: viewport.clientHeight,
          viewport: { top: clip.top, bottom: clip.bottom, height: clip.height },
          rows: elements.map((el) => {
            const r = el.getBoundingClientRect();
            return {
              id: el.getAttribute('data-workspace-id'),
              top: r.top,
              bottom: r.bottom,
              height: r.height,
            };
          }),
        };
      }),
      null,
      2,
    ),
  );
  await expect
    .poll(() =>
      rows.evaluateAll((elements) => {
        const viewport = elements[0].closest('[data-dock-scroll]')!.getBoundingClientRect();
        return elements.every((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= viewport.top - 1 && r.bottom <= viewport.bottom + 1;
        });
      }),
    )
    .toBe(true);
});

test.describe('older disclosure normal motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });
  for (const mode of ['floating-down', 'floating-up', 'notch'] as const) {
    test(`${mode} grows from the painted list height without jumping and keeps its anchor`, async ({
      mount,
      page,
    }, info) => {
      await page.setViewportSize({ width: 720, height: 960 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
      await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
      const component = await mount(Harness, { props: { allOld: true, total: 8, mode } });
      await expect(page.getByTestId('dock-recency-boundary')).toHaveAttribute(
        'data-visible-ids',
        '["old-human-1","old-human-2","old-human-3"]',
      );
      await component.getByTestId('dock-drag-handle').hover();
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      const surface = component.locator('section[data-dock-surface]');
      const disclosure = component.getByRole('button', { name: 'Show older', exact: true });
      await surface.screenshot({
        path: info.outputPath(`${mode}-motion-before.png`),
        animations: 'allow',
      });
      await disclosure.evaluate((button) => {
        type Frame = { at: number; height: number; top: number; bottom: number };
        const state = window as unknown as { __olderMotion: Promise<Frame[]> };
        state.__olderMotion = new Promise((resolve) => {
          button.addEventListener(
            'click',
            () => {
              const path = button
                .closest('[data-dock-surface]')!
                .querySelector('.shell-silhouette > path')!;
              const start = performance.now();
              const frames: Frame[] = [];
              const sample = () => {
                const rect = path.getBoundingClientRect();
                frames.push({
                  at: performance.now() - start,
                  height: rect.height,
                  top: rect.top,
                  bottom: rect.bottom,
                });
                if (performance.now() - start < 900) requestAnimationFrame(sample);
                else resolve(frames);
              };
              sample();
            },
            { once: true, capture: true },
          );
        });
      });
      await disclosure.click();
      const frames = await page.evaluate(
        () =>
          (
            window as unknown as {
              __olderMotion: Promise<
                Array<{ at: number; height: number; top: number; bottom: number }>
              >;
            }
          ).__olderMotion,
      );
      await surface.screenshot({
        path: info.outputPath(`${mode}-motion-after.png`),
        animations: 'allow',
      });
      await writeFile(
        info.outputPath(`${mode}-motion-frames.json`),
        JSON.stringify(
          { mode, boundary: 'actual browser silhouette; mocked native geometry', frames },
          null,
          2,
        ),
      );
      expect(frames.length).toBeGreaterThan(5);
      const first = frames[0];
      const final = frames.at(-1)!;
      expect(final.height - first.height).toBeGreaterThan(50);
      expect(Math.max(...frames.map((frame) => frame.height))).toBeLessThanOrEqual(
        final.height + 0.75,
      );
      for (let index = 1; index < frames.length; index++) {
        expect(frames[index].height - frames[index - 1].height).toBeGreaterThanOrEqual(-0.75);
      }
      const edge = mode === 'floating-up' ? 'bottom' : 'top';
      expect(Math.max(...frames.map((frame) => Math.abs(frame[edge] - first[edge])))).toBeLessThan(
        0.75,
      );
    });
  }
});
