import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockShortcutContext } from '$shared/dock-shortcuts';

type Fixture = {
  shortcut(context: DockShortcutContext): void;
  archiveWorkspace(id: string): void;
  seedChoices(count: number): void;
  store: {
    state: { connections: { windowBackendId: string }; dockConversation: { loading: boolean } };
  };
  native: {
    log: {
      captures: number;
      annotations: unknown[];
      speech: { started: unknown[] };
      clips: { started: unknown[] };
    };
  };
};
async function invoke(
  page: import('@playwright/test').Page,
  action: DockShortcutContext['action'],
  id: string,
  url?: string,
) {
  await page.evaluate(
    ({ action, id, url }) => {
      const h = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
      h.shortcut({
        id,
        action,
        backendId: h.store.state.connections.windowBackendId,
        appId: 'synthetic.review',
        appName: 'Synthetic review',
        url,
      });
    },
    { action, id, url },
  );
}
for (const action of ['capture', 'annotate', 'dictate'] as const) {
  test(`${action} routes a global action once through the real native owner`, async ({
    mount,
    page,
  }, info) => {
    await mount(Harness);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
              .dockConversation.loading,
        ),
      )
      .toBe(false);
    await invoke(page, action, 'expanded-action');
    await page.getByRole('button', { name: /Connected companion fixture/ }).click();
    await expect
      .poll(() =>
        page.evaluate((action) => {
          const log = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native
            .log;
          return action === 'capture'
            ? log.captures
            : action === 'annotate'
              ? log.annotations.length
              : log.speech.started.length;
        }, action),
      )
      .toBe(1);
    const log = await page.evaluate(
      () => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log,
    );
    expect(log.clips.started).toHaveLength(0);
    await writeFile(
      info.outputPath(`${action}-dispatch.json`),
      JSON.stringify(
        {
          boundary: 'Real renderer/sagas, browser-injected IPC and synthetic native boundary.',
          action,
          log,
        },
        null,
        2,
      ),
    );
  });
}
test('remember scope resets and archived saved destinations stay out', async ({ mount, page }) => {
  await mount(Harness);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.loading,
      ),
    )
    .toBe(false);
  await invoke(page, 'focus', 'scope-first');
  await page.getByRole('button', { name: 'This app', exact: true }).click();
  await invoke(page, 'focus', 'scope-second');
  await expect(page.getByRole('button', { name: 'Just once', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'This app', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'This app', exact: true }).click();
  await page.getByRole('button', { name: /Connected companion fixture/ }).click();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.archiveWorkspace(
      'conversation-wire',
    ),
  );
  await invoke(page, 'focus', 'archived');
  await expect(page.getByText('Open which workspace?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Connected companion fixture/ })).toHaveCount(0);
});
test('340px actual shell keeps long URLs, large lists and Cancel usable', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 640, height: 340 });
  const props = dockRailPreview.states.notch.props;
  await mount(Harness, {
    props: {
      shell: {
        ...props,
        viewportHeight: 340,
        placement: {
          ...props.placement!,
          windowBounds: { ...props.placement!.windowBounds, height: 340 },
        },
      },
    },
  });
  await page.getByTestId('dock-drag-handle').hover();
  await page.locator('.overview-row').first().click();
  await expect(page.getByTestId('dock-conversation-surface')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.seedChoices(40),
  );
  await invoke(
    page,
    'focus',
    'short-shell',
    `https://example.test/project/${'long-segment/'.repeat(30)}page`,
  );
  const chooser = page.getByTestId('dock-shortcut-routing');
  const cancel = chooser.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeInViewport({ ratio: 1 });
  const list = chooser.getByTestId('dock-shortcut-list');
  const geometry = await list.evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(geometry.client).toBeGreaterThan(30);
  expect(geometry.scroll).toBeGreaterThan(geometry.client);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  await list.getByRole('button', { name: /Synthetic workspace 39 / }).scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('short-shell-chooser.png') });
  await writeFile(info.outputPath('short-shell-geometry.json'), JSON.stringify(geometry, null, 2));
  await cancel.click();
  await expect(chooser).toHaveCount(0);
});
