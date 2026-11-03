import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import type { DockShortcutContext } from '$shared/dock-shortcuts';

type Fixture = {
  shortcut(context: DockShortcutContext): void;
  store: {
    state: {
      connections: { windowBackendId: string };
      dockConversation: { shortcut?: { destination: string | null }; loading: boolean };
    };
  };
  native: { log: { clips: { started: string[]; stopped: string[] } } };
};
async function invoke(
  page: import('@playwright/test').Page,
  action: 'focus' | 'record',
  extra: Partial<DockShortcutContext> = {},
) {
  await page.evaluate(
    ({ action, extra }) => {
      const h = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
      h.shortcut({
        id: crypto.randomUUID(),
        backendId: h.store.state.connections.windowBackendId,
        appId: 'synthetic.editor',
        appName: 'Synthetic editor',
        action,
        ...extra,
      });
    },
    { action, extra },
  );
}
for (const action of ['focus', 'record'] as const) {
  test(`${action} resolves an unknown foreground app before acting`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 480, height: 760 });
    await mount(Harness, { props: { height: 700 } });
    await expect(page.getByTestId('composer-e2e')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
              .dockConversation.loading,
        ),
      )
      .toBe(false);
    await invoke(page, action);
    await expect(
      page.getByText(action === 'focus' ? 'Open which workspace?' : 'Record in which workspace?'),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log.clips
              .started.length,
        ),
      )
      .toBe(0);
    await page.getByRole('button', { name: 'This app', exact: true }).click();
    await page.getByRole('button', { name: /Connected companion fixture/ }).click();
    await expect(
      page.getByText(
        `${action === 'focus' ? 'Prompt' : 'Recording'} destination: Connected companion fixture`,
      ),
    ).toBeVisible();
    if (action === 'record')
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log
                .clips.started.length,
          ),
        )
        .toBe(1);
    const artifact = info.outputPath(`${action}-destination.png`);
    await page.screenshot({ path: artifact });
    await info.attach('destination', { path: artifact, contentType: 'image/png' });
    await invoke(page, action);
    await expect(
      page.getByText(
        `${action === 'focus' ? 'Prompt' : 'Recording'} destination: Connected companion fixture`,
      ),
    ).toBeVisible();
    const repeated = await page.evaluate(
      () =>
        (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log.clips,
    );
    expect(repeated.started).toHaveLength(action === 'record' ? 1 : 0);
    expect(repeated.stopped).toHaveLength(action === 'record' ? 1 : 0);
    // A page URL takes precedence over the remembered broad app association.
    await invoke(page, 'focus', { url: 'https://example.test/unknown-page' });
    await expect(page.getByText('Open which workspace?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    // A foreign backend event cannot open a chooser or start recording.
    await invoke(page, 'record', { backendId: 'synthetic-other-backend' });
    await expect(page.getByTestId('dock-shortcut-routing')).toHaveCount(0);
    const log = await page.evaluate(
      () => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log,
    );
    expect(log.clips.started).toHaveLength(action === 'record' ? 1 : 0);
    const evidence = info.outputPath(`${action}-routing.json`);
    await writeFile(
      evidence,
      JSON.stringify(
        {
          boundary:
            'Real renderer/sagas; synthetic daemon/native. No system hotkey or OS capture asserted.',
          action,
          log,
        },
        null,
        2,
      ),
    );
    await info.attach('routing evidence', { path: evidence, contentType: 'application/json' });
  });
}
