import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { adaptiveDockFixture, dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockShortcutContext } from '$shared/dock-shortcuts';
import {
  dockLocalRect,
  dockWindowEnvelope,
  resolveDockSurface,
  type DockDisplayGeometry,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';

/**
 * The open shortcut with the dock on a screen side (edge placement) and no destination
 * from the foreground: it opens the last chat opened from the dock (same machine and
 * authority, still present), else the first workspace, expands it and focuses its real
 * composer, instead of only focusing the Assistant entry. Real store, sagas, rail and shell.
 */
type Fixture = {
  shortcut(context: DockShortcutContext): void;
  close(): void;
  reopen(): void;
  seedChoices(count: number): void;
  archiveWorkspace(id: string): void;
  store: {
    state: {
      connections: { windowBackendId: string };
      dockConversation: {
        workspaceId: string | null;
        loading: boolean;
        shortcut?: { destination: string | null } | null;
        shortcutSelection?: Record<string, unknown> | null;
      };
    };
    dispatch(action: { type: string; payload?: unknown[] }): void;
  };
};
const h = (page: Page) =>
  page.evaluate.bind(page) as <T, A>(fn: (arg: A) => T, arg: A) => Promise<T>;

async function mountSide(mount: Parameters<Parameters<typeof test>[1]>[0]['mount'], page: Page) {
  await page.setViewportSize({ width: 1000, height: 700 });
  // A simulated display, so the preview answers side-panel requests like native does.
  const display: DockDisplayGeometry = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1000, height: 700 },
    workArea: { x: 0, y: 24, width: 1000, height: 676 },
    cutout: null,
  };
  const target = { kind: 'edge' as const, displayId: 1, side: 'right' as const, along: 0.5 };
  const core = resolveDockSurface(target, display, { width: 40, height: 260 });
  const windowBounds = dockWindowEnvelope(core, display, null, 'right', true, 24);
  const placement: DockPlacementSnapshot = {
    ...adaptiveDockFixture('edge', 'right'),
    placement: target,
    windowBounds,
    surface: dockLocalRect(core, windowBounds),
    workArea: dockLocalRect(display.workArea, windowBounds),
  };
  await mount(Harness, {
    props: {
      shell: {
        ...dockRailPreview.states['side-right'].props,
        placement,
        floatingDisplay: display,
        resizeAcknowledgement: 'accept',
      },
    },
  });
  await h(page)((snapshot) => {
    const { store } = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
    store.dispatch({ type: 'hud/dockActivated' });
    store.dispatch({ type: 'hud/dockPlacementReceived', payload: [snapshot] });
  }, placement);
  await expect.poll(() => state(page, 'loading')).toBe(false);
}
function state<K extends 'workspaceId' | 'loading' | 'destination'>(page: Page, key: K) {
  return page.evaluate((key) => {
    const dock = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
      .dockConversation;
    return key === 'destination' ? (dock.shortcut?.destination ?? null) : dock[key];
  }, key);
}
async function press(page: Page, extra: Partial<DockShortcutContext> = {}) {
  await h(page)((extra) => {
    const fixture = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
    fixture.shortcut({
      id: crypto.randomUUID(),
      backendId: fixture.store.state.connections.windowBackendId,
      action: 'focus',
      ...extra,
    });
  }, extra);
}
async function close(page: Page) {
  await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.close(), null);
  await expect.poll(() => state(page, 'workspaceId')).toBeNull();
}
const composerFocused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return !!active?.closest('.tiptap-editor') || active?.getAttribute('contenteditable') === 'true';
  });
const firstEntry = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[data-dock-entry]')]
        .map((entry) => entry.dataset.dockEntry!)
        .find((id) => id !== 'dock:assistant') ?? null,
  );

test('side: a cold shortcut opens the first workspace chat and focuses its composer', async ({ mount, page }, info) => {
  await mountSide(mount, page);
  await close(page);
  const first = await firstEntry(page);
  expect(first).not.toBeNull();
  await press(page);
  await expect.poll(() => state(page, 'workspaceId')).toBe(first);
  await expect.poll(() => composerFocused(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('side-cold-first-workspace.png') });
  await writeFile(info.outputPath('side-cold-receipt.json'), JSON.stringify({ opened: 'first entry', composerFocused: true }));
});

test('side: the shortcut returns to the last chat opened from the dock', async ({ mount, page }, info) => {
  await mountSide(mount, page);
  await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.seedChoices(3), null);
  await close(page);
  await page.locator('[data-dock-entry="choice-1"]').click();
  await expect.poll(() => state(page, 'workspaceId')).toBe('choice-1');
  await close(page);
  // The pointer moves away from the side; the press comes from the keyboard.
  await page.mouse.move(200, 200);
  await press(page);
  await expect.poll(() => state(page, 'workspaceId')).toBe('choice-1');
  // Synthetic workspaces have no agent fixture (no composer; composer focus is proven on
  // the fixture workspace in the other cases): the chat opens, not the Assistant preview.
  await expect(page.getByTestId('dock-edge-shell')).toBeVisible();
  await expect(page.locator('[data-dock-entry="dock:assistant"]')).not.toBeFocused();
  await expect(page.locator('[data-preview-workspace-id="dock:assistant"]')).toHaveCount(0);
  await writeFile(info.outputPath('side-last-receipt.json'), JSON.stringify({ opened: 'choice-1', edgeShell: 'visible', assistantPreview: false }));
});

test('side: a removed last chat, or one from another machine, falls back to the first workspace', async ({ mount, page }, info) => {
  await mountSide(mount, page);
  await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.seedChoices(3), null);
  await close(page);
  await page.locator('[data-dock-entry="choice-1"]').click();
  await expect.poll(() => state(page, 'workspaceId')).toBe('choice-1');
  await close(page);
  await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.archiveWorkspace('choice-1'), null);
  const first = await firstEntry(page);
  expect(first).not.toBe('choice-1');
  await press(page);
  await expect.poll(() => state(page, 'workspaceId')).toBe(first);
  await expect.poll(() => composerFocused(page)).toBe(true);

  await page.locator('[data-dock-entry="choice-2"]').click();
  await expect.poll(() => state(page, 'workspaceId')).toBe('choice-2');
  await close(page);
  await h(page)(() => {
    const { store } = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
    const selection = store.state.dockConversation.shortcutSelection;
    store.dispatch({ type: 'dockConversation/shortcutSelectionChanged', payload: [{ ...selection, backendId: 'another-machine' }] });
  }, null);
  await press(page);
  await expect.poll(() => state(page, 'workspaceId')).toBe(await firstEntry(page));
  await writeFile(info.outputPath('side-fence-receipt.json'), JSON.stringify({ removed: 'first', otherMachine: 'first' }));
});

test('side: with a chat open but unfocused, the shortcut keeps that chat instead of the chooser', async ({ mount, page }) => {
  await mountSide(mount, page);
  const open = await state(page, 'workspaceId');
  expect(open).not.toBeNull();
  await press(page);
  await expect.poll(() => state(page, 'destination')).toBe(open);
  await expect.poll(() => composerFocused(page)).toBe(true);
});

for (const conflict of ['a different last chat', 'a foreground workspace with a URL'] as const) {
  test(`side: the open chat wins over ${conflict}`, async ({ mount, page }, info) => {
    await mountSide(mount, page);
    const open = await state(page, 'workspaceId');
    expect(open).not.toBeNull();
    await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.seedChoices(2), null);
    // Remember choice-1 as the last chat, then return to the fixture chat (A).
    await close(page);
    await page.locator('[data-dock-entry="choice-1"]').click();
    await expect.poll(() => state(page, 'workspaceId')).toBe('choice-1');
    await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.reopen(), null);
    await expect.poll(() => state(page, 'workspaceId')).toBe(open);
    await page.mouse.move(200, 200);
    await press(
      page,
      conflict === 'a foreground workspace with a URL'
        ? { workspaceId: 'choice-1', url: 'https://example.com/choice-1', appId: 'com.example.browser' }
        : {},
    );
    await expect.poll(() => state(page, 'destination')).toBe(open);
    expect(await state(page, 'workspaceId')).toBe(open);
    await expect.poll(() => composerFocused(page)).toBe(true);
    await writeFile(info.outputPath('side-conflict-receipt.json'), JSON.stringify({ conflict, kept: 'open chat', composerFocused: true }));
  });
}

test('side, focused but collapsed: the open shortcut again opens the first workspace chat, not the Assistant', async ({ mount, page }, info) => {
  await mountSide(mount, page);
  const first = await firstEntry(page);
  await close(page);
  await page.mouse.move(200, 200);
  await press(page, { toggleClose: true });
  await expect.poll(() => state(page, 'workspaceId')).toBe(first);
  await expect.poll(() => composerFocused(page)).toBe(true);
  await expect(page.locator('[data-dock-entry="dock:assistant"]')).not.toBeFocused();
  await writeFile(info.outputPath('side-toggle-cold-receipt.json'), JSON.stringify({ toggleClose: true, opened: 'first entry', composerFocused: true }));
});

test('side, focused but collapsed after Back: the open shortcut again returns to that last chat', async ({ mount, page }, info) => {
  await mountSide(mount, page);
  await h(page)(() => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.seedChoices(2), null);
  await close(page);
  await page.locator('[data-dock-entry="choice-1"]').click();
  await expect.poll(() => state(page, 'workspaceId')).toBe('choice-1');
  // Back.
  await close(page);
  await page.mouse.move(200, 200);
  await press(page, { toggleClose: true });
  await expect.poll(() => state(page, 'workspaceId')).toBe('choice-1');
  await expect(page.getByTestId('dock-edge-shell')).toBeVisible();
  await expect(page.locator('[data-dock-entry="dock:assistant"]')).not.toBeFocused();
  await expect(page.locator('[data-preview-workspace-id="dock:assistant"]')).toHaveCount(0);
  await writeFile(info.outputPath('side-toggle-last-receipt.json'), JSON.stringify({ toggleClose: true, opened: 'choice-1' }));
});

test('side, with the chat open and focused: the open shortcut again closes it as Escape would', async ({ mount, page }) => {
  await mountSide(mount, page);
  const open = await state(page, 'workspaceId');
  await press(page);
  await expect.poll(() => composerFocused(page)).toBe(true);
  await press(page, { toggleClose: true });
  await expect(page.getByTestId('dock-edge-shell')).toHaveCount(0);
  // The chat stays chosen; only the side conversation closed.
  expect(await state(page, 'workspaceId')).toBe(open);
});
