import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import type { DockShortcutContext } from '$shared/dock-shortcuts';
import type { ScriptListEntry, ScriptRuntimeState } from '$features/scripts/types';

type Fixture = {
  disconnect(): void;
  shortcut(context: DockShortcutContext): void;
  store: {
    state: { connections: { windowBackendId: string }; dockConversation: { loading: boolean } };
  };
  native: { log: { clips: { started: string[] } } };
  calls: { method: string; params: Record<string, unknown> }[];
  fixture: {
    setServices(rows: ScriptListEntry[], override?: ScriptRuntimeState | null): void;
    holdServiceList(value: boolean): void;
  };
};
const runtime: ScriptRuntimeState = {
  runId: 'synthetic-run-1',
  status: 'running',
  pid: 1234,
  startedAt: '2026-11-03T00:00:00Z',
  restartCount: 0,
  detectedUrl: 'http://localhost:5173/project/',
};
const service = {
  id: 'synthetic-service',
  workspaceId: 'conversation-wire',
  name: 'Synthetic preview',
  mode: 'service',
  purpose: 'saved',
  source: 'manual',
  createdAt: '2026-11-03T00:00:00Z',
  commandPreview: 'synthetic fixture',
  commandTruncated: false,
  runtime,
} satisfies ScriptListEntry;

for (const scenario of [
  'live',
  'exited',
  'reused',
  'ambiguous',
  'late',
  'reconnect',
  'path',
  'unmapped',
  'wildcard',
  'ipv6wildcard',
] as const) {
  test(`service routing respects ${scenario} runtime ownership`, async ({ mount, page }, info) => {
    await mount(Harness, { props: { height: 700 } });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
              .dockConversation.loading,
        ),
      )
      .toBe(false);
    await page.evaluate(
      ({ service, scenario }) => {
        const h = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
        const row = structuredClone(service);
        if (scenario === 'exited') row.runtime.status = 'exited';
        const rows =
          scenario === 'ambiguous'
            ? [
                row,
                {
                  ...row,
                  id: 'another-service',
                  runtime: { ...row.runtime, pid: 2345, runId: 'other-run' },
                },
              ]
            : [row];
        h.fixture.setServices(
          rows,
          scenario === 'reused' ? { ...row.runtime, runId: 'replacement-run', pid: 3456 } : null,
        );
        h.fixture.holdServiceList(scenario === 'late' || scenario === 'reconnect');
        h.shortcut({
          id: 'service-action',
          backendId: h.store.state.connections.windowBackendId,
          action: 'record',
          appName: 'Synthetic browser',
          url:
            scenario === 'wildcard'
              ? 'http://0.0.0.0:5173/project/page'
              : scenario === 'ipv6wildcard'
                ? 'http://[::]:5173/project/page'
                : 'http://127.0.0.1:61999/project/page',
          serviceAddress: ['unmapped', 'wildcard', 'ipv6wildcard'].includes(scenario)
            ? undefined
            : scenario === 'path'
              ? 'http://127.0.0.1:5173/project-other/page'
              : 'http://127.0.0.1:5173/project/page',
        });
      },
      { service, scenario },
    );
    if (!['unmapped', 'wildcard', 'ipv6wildcard'].includes(scenario))
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.calls.some(
              (row) => row.method === 'script.list',
            ),
          ),
        )
        .toBe(true);
    if (scenario === 'late' || scenario === 'reconnect') {
      if (scenario === 'late')
        await page.evaluate(() =>
          (window as unknown as { __dockComposerE2E: { close(): void } }).__dockComposerE2E.close(),
        );
      else
        await page.evaluate(() =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.disconnect(),
        );
      await page.evaluate(() =>
        (
          window as unknown as { __dockComposerE2E: Fixture }
        ).__dockComposerE2E.fixture.holdServiceList(false),
      );
    }
    if (scenario === 'reused')
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.calls.some(
              (row) => row.method === 'script.status',
            ),
          ),
        )
        .toBe(true);
    if (scenario === 'live') {
      await expect(page.getByTestId('dock-conversation-surface')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log
                .clips.started.length,
          ),
        )
        .toBe(1);
    } else if (scenario !== 'late' && scenario !== 'reconnect') {
      await page.getByTestId('dock-drag-handle').hover();
      await expect(page.getByTestId('dock-overview')).toBeVisible();
    }
    const evidence = await page.evaluate(() => {
      const h = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
      return {
        calls: h.calls.filter((row) => row.method.startsWith('script.')),
        native: h.native.log,
      };
    });
    if (!['unmapped', 'wildcard', 'ipv6wildcard'].includes(scenario))
      expect(evidence.calls).toContainEqual({
        method: 'script.list',
        params: {
          workspaceId: 'conversation-wire',
          archive: 'active',
          view: 'summary',
          limit: 100,
        },
      });
    if (scenario === 'live' || scenario === 'reused')
      expect(evidence.calls).toContainEqual({
        method: 'script.status',
        params: { workspaceId: 'conversation-wire', scriptId: 'synthetic-service' },
      });
    expect(evidence.native.clips.started).toHaveLength(scenario === 'live' ? 1 : 0);
    const artifact = info.outputPath(`${scenario}-ownership.json`);
    await writeFile(
      artifact,
      JSON.stringify(
        {
          scenario,
          boundary: 'Production routing and wire client; synthetic daemon and native recorder.',
          ...evidence,
        },
        null,
        2,
      ),
    );
    await info.attach('service ownership evidence', {
      path: artifact,
      contentType: 'application/json',
    });
    await page.screenshot({ path: info.outputPath(`${scenario}-routing.png`) });
  });
}
