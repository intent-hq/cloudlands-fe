import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import type { DockShortcutContext } from '$shared/dock-shortcuts';

type Fixture = {
  shortcut(context: DockShortcutContext): void;
  archiveWorkspace(id: string): void;
  seedChoices(count: number): void;
  seedWorkspace(workspace: import('$shared/types').Workspace): void;
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
for (const action of ['capture', 'dictate'] as const) {
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
    await page.getByTestId('dock-drag-handle').hover();
    await page
      .getByTestId('dock-overview')
      .getByRole('button', { name: /Connected companion fixture/ })
      .click();
    await expect
      .poll(() =>
        page.evaluate((action) => {
          const log = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native
            .log;
          return action === 'capture' ? log.captures : log.speech.started.length;
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
for (const action of ['record', 'dictate'] as const) {
  test(`${action} stops its active A owner when foreground context changes to B`, async ({
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
    await invoke(page, action, 'start-A');
    await page.getByTestId('dock-drag-handle').hover();
    await page
      .getByTestId('dock-overview')
      .getByRole('button', { name: /Connected companion fixture/ })
      .click();
    await expect
      .poll(() =>
        page.evaluate((action) => {
          const log = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native
            .log;
          return action === 'record' ? log.clips.started.length : log.speech.started.length;
        }, action),
      )
      .toBe(1);
    await page.evaluate((action) => {
      const h = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
      h.seedChoices(1);
      h.shortcut({
        id: 'foreground-B',
        action,
        backendId: h.store.state.connections.windowBackendId,
        appId: 'synthetic.other-app',
        appName: 'Synthetic B',
        url: 'https://example.test/B',
        workspaceId: 'choice-0',
      });
    }, action);
    await expect
      .poll(() =>
        page.evaluate((action) => {
          const h = (
            window as unknown as {
              __dockComposerE2E: Fixture & {
                native: {
                  log: {
                    clips: { stopped: unknown[] };
                    ended: unknown[];
                    speech: { stopped: unknown[] };
                  };
                };
              };
            }
          ).__dockComposerE2E;
          return action === 'record'
            ? h.native.log.clips.stopped.length
            : h.native.log.speech.stopped.length;
        }, action),
      )
      .toBe(1);
    const evidence = await page.evaluate(() => {
      const h = (
        window as unknown as {
          __dockComposerE2E: Fixture & {
            store: {
              state: {
                dockConversation: { workspaceId: string; shortcut: { destination: string } };
              };
            };
          };
        }
      ).__dockComposerE2E;
      return {
        workspaceId: h.store.state.dockConversation.workspaceId,
        destination: h.store.state.dockConversation.shortcut.destination,
        log: h.native.log,
      };
    });
    expect(evidence.workspaceId).toBe('conversation-wire');
    expect(evidence.destination).toBe('conversation-wire');
    const starts =
      action === 'record' ? evidence.log.clips.started.length : evidence.log.speech.started.length;
    expect(starts).toBe(1);
    await writeFile(
      info.outputPath(`${action}-active-owner.json`),
      JSON.stringify(
        {
          action,
          foregroundWorkspace: 'choice-0',
          boundary: 'Real renderer/native owner, synthetic foreground context and native recorder.',
          ...evidence,
        },
        null,
        2,
      ),
    );
  });
}
