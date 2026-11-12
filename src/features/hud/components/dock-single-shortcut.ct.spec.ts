import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockLinkedContextSnapshot } from '$shared/dock-context-links';
import { SHORTCUT_DEFAULTS } from '../../../shared/keyboard-shortcut-bindings';
import { DOCK_SHORTCUT_IDS, dockShortcutBindings } from '../../../shared/dock-shortcut-settings';
import { createDockShortcutRegistration } from '../../../main/dock-shortcut-registration';
import { createDockShortcutPreferences } from '../../../main/dock-shortcut-preferences';

/**
 * The one global dock shortcut (Ctrl+Shift+D): the conversation linked to the foreground tab or
 * app the feed admitted at the press, else the searchable index where that context can be
 * linked; nothing else. The renderer runs the real dock shortcut + context-links sagas in the
 * notch shell; main's press is what `window:focus-dock` delivers (OS key delivery and native
 * foreground sampling are not exercised). Registry and saved-preference handling run the real
 * shared/main modules with a fake globalShortcut.
 */
test('single dock shortcut: linked conversation, else the index; old keys gone', async ({
  mount,
  page,
}, info) => {
  test.setTimeout(150_000);
  const receipts: Record<string, unknown> = {};

  // 1. One global binding; former dock defaults are gone; saved former overrides neither
  // break loading nor disappear from storage.
  expect([...DOCK_SHORTCUT_IDS]).toEqual(['dock.focus', 'dock.capture', 'dock.record']);
  expect(SHORTCUT_DEFAULTS['dock.focus']).toBe('ctrl+shift+d');
  const formerDefaults = ['dock.dictate', 'dock.related'].filter((id) => id in SHORTCUT_DEFAULTS);
  expect(formerDefaults).toEqual([]);
  expect(Object.keys(dockShortcutBindings())).toEqual(['focus', 'capture', 'record']);
  const registered: string[] = [];
  const registration = createDockShortcutRegistration(
    {
      register: (key: string) => {
        registered.push(key);
        return true;
      },
      unregister: () => {},
    },
    () => {},
    () => {},
    'darwin',
  );
  const saved = {
    'dock.focus': 'ctrl+alt+d',
    'dock.capture': 'ctrl+shift+s',
    'dock.related': 'ctrl+shift+a',
  };
  const writes: unknown[] = [];
  const prefs = createDockShortcutPreferences({
    registrar: registration,
    read: async () => saved,
    write: async (value) => void writes.push(value),
    changed: () => {},
    platform: 'darwin',
  });
  const loaded = await prefs.load();
  prefs.enable(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const afterEnable = prefs.snapshot();
  expect(afterEnable.issues).toEqual([]);
  expect(afterEnable.overrides).toEqual({ 'dock.focus': 'ctrl+alt+d' });
  expect(afterEnable.registered).toEqual(['focus', 'capture', 'record']);
  expect(registered).toEqual(['Control+Alt+D', 'Control+Shift+S', 'Control+Shift+R']);
  await prefs.update({
    id: 'dock.focus',
    key: 'ctrl+shift+d',
    expectedRevision: prefs.snapshot().revision,
  });
  expect(writes.at(-1)).toEqual({ 'dock.related': 'ctrl+shift+a' });
  receipts.registry = {
    ids: [...DOCK_SHORTCUT_IDS],
    defaultFocus: SHORTCUT_DEFAULTS['dock.focus'],
    formerDefaultsPresent: formerDefaults,
    loadIssues: loaded.issues,
    registeredAccelerators: registered,
    writtenAfterResetToDefault: writes.at(-1),
  };

  // 2. The dock, a draft in the open conversation.
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.seedChoices(3);
    h.contextReady();
  });
  const read = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.contextSnapshot(),
    ) as Promise<DockLinkedContextSnapshot | null>;
  const open = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
    ) as Promise<string | null>;
  const origin = (await open())!;
  const draftLength = (workspaceId: string) =>
    page.evaluate((id) => {
      const map = (window as any).__dockComposerE2E.store.state.dockConversation.drafts?.map ?? {};
      const entry = Object.entries(map).find(([key]) => JSON.parse(key)[0] === id);
      return ((entry?.[1] as { text?: string } | undefined)?.text ?? '').length;
    }, workspaceId);
  const DRAFT = 'Keep this draft';
  await page.locator('.tiptap-editor').first().click();
  await page.keyboard.type(DRAFT);
  await expect.poll(() => draftLength(origin)).toBe(DRAFT.length);
  let sequence = 0;
  const observe = (version: string, url: string, workspaceId?: string) =>
    page.evaluate(
      ({ version, url, sequence, workspaceId }) => {
        const h = (window as any).__dockComposerE2E;
        h.context({
          sequence,
          contextVersion: version,
          backendId: h.store.state.connections.windowBackendId,
          identityKey: `url:${url}`,
          identityKind: 'url',
          self: false,
          appId: 'com.apple.Safari',
          appName: 'Synthetic Safari',
          url,
          icon: null,
          ...(workspaceId ? { workspaceId } : {}),
        });
      },
      { version, url, sequence: ++sequence, workspaceId },
    );
  // What main sends for a Ctrl+Shift+D press (an admitted sample carries its version).
  const press = (
    admitted?: { version: string; url: string },
    extra: Record<string, unknown> = {},
  ) =>
    page.evaluate(
      ({ admitted, extra }) => {
        const h = (window as any).__dockComposerE2E;
        h.shortcut({
          id: crypto.randomUUID(),
          backendId: h.store.state.connections.windowBackendId,
          action: 'focus',
          ...(admitted
            ? {
                url: admitted.url,
                identityKey: `url:${admitted.url}`,
                contextVersion: admitted.version,
              }
            : {}),
          ...extra,
        });
      },
      { admitted, extra },
    );
  const overview = page.getByTestId('dock-overview');
  const back = page.locator('[data-dock-conversation-back]');
  const search = page.locator('[data-dock-search]');
  const row = (id: string) =>
    page.locator('.overview-row', { has: page.locator(`[data-workspace-id="${id}"]`) });
  const shortcutState = () =>
    page.evaluate(() => {
      const s = (window as any).__dockComposerE2E.store.state.dockConversation.shortcut;
      return s ? { destination: s.destination, resolving: !!s.resolving } : null;
    });
  const leaveIndex = async () => {
    // Choosing nothing: the dock's own cancel of a pending shortcut (as on dismiss).
    await page.evaluate(() =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/shortcutChanged',
        payload: [null],
      }),
    );
  };
  // No conversation selected (Back): the press routes to the linked conversation or index.
  const blank = async () => {
    await page.evaluate(() => (window as any).__dockComposerE2E.close());
    await expect.poll(open).toBeNull();
  };

  // 3. No admitted context (unknown app / Intent itself): the index, search focused, nothing
  // opened, no row offers Link (the context is unknown).
  await blank();
  await press();
  await expect(overview).toBeVisible();
  await expect(search).toBeFocused();
  expect(await open()).toBeNull();
  expect(await shortcutState()).toEqual({ destination: null, resolving: false });
  // The list has timestamps only: no link controls or tags in rows.
  await expect(
    page.locator('.overview-row [data-dock-row-action], [data-dock-linked-tag]'),
  ).toHaveCount(0);
  expect(await page.locator('.overview-row[role="row"] .row-time').count()).toBe(
    await page.locator('.overview-row[role="row"]').count(),
  );
  await page.screenshot({ path: info.outputPath('11-d-unknown-index.png') });
  receipts.unknown = { index: true, searchFocused: true, opened: null, linkControls: 0 };
  await leaveIndex();

  // 4. A known unlinked tab: the index, where its row can be linked; the next press follows.
  const A = 'https://github.com/example/one/issues/1';
  await observe('v1', A);
  await expect.poll(() => read().then((s) => s?.url)).toBe(A);
  await press({ version: 'v1', url: A });
  await expect(overview).toBeVisible();
  await expect(search).toBeFocused();
  expect(await open()).toBeNull();
  // Open the workspace from the index; its header Link menu offers This tab / This app.
  await row('choice-1').locator('[data-workspace-id]').click();
  await expect.poll(open).toBe('choice-1');
  const headerLink = page.locator('[data-dock-header-link]');
  const thisTab = page.getByRole('menuitemcheckbox', { name: 'This tab' });
  const thisApp = page.getByRole('menuitemcheckbox', { name: 'This app' });
  await expect(headerLink).not.toHaveAttribute('data-linked', /.*/);
  await expect(headerLink).toHaveAttribute(
    'aria-label',
    /Link github\.com to Synthetic workspace 1/,
  );
  await headerLink.click();
  await expect(thisTab).toHaveAttribute('aria-checked', 'false');
  await expect(thisApp).toBeVisible();
  await thisTab.click();
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-1');
  await expect.poll(() => read().then((s) => s?.linkScopes?.tab.savedWorkspaceId)).toBe('choice-1');
  await expect(headerLink).toHaveAttribute('data-linked', 'true');
  await headerLink.click();
  await expect(thisTab).toHaveAttribute('aria-checked', 'true');
  // The dock stays expanded while its menu is used.
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-expanded', 'true');
  await page.screenshot({ path: info.outputPath('12-d-header-linked.png') });
  await page.keyboard.press('Escape');
  await expect(thisTab).toBeHidden();
  await blank();
  await press({ version: 'v1', url: A });
  await expect.poll(open).toBe('choice-1');
  await expect(back).toBeVisible();
  expect(await shortcutState()).toBeNull();
  await expect.poll(() => read().then((s) => s?.policy.follows)).toBe(1);
  expect(await draftLength(origin)).toBe(DRAFT.length);
  // 4b. Following into a conversation with a real agent: its composer takes the keyboard
  // and still holds the draft written there.
  const E = 'https://github.com/example/fixture/issues/9';
  await observe('v4', E);
  await expect.poll(() => read().then((s) => s?.url)).toBe(E);
  await page.evaluate((id) => (window as any).__dockComposerE2E.contextAction('link', id), origin);
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe(origin);
  await blank();
  await press({ version: 'v4', url: E });
  await expect.poll(open).toBe(origin);
  const composer = page.locator('.tiptap-editor').first();
  await expect(composer).toContainText(DRAFT);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return (
          !!active?.closest('.tiptap-editor') || active?.getAttribute('contenteditable') === 'true'
        );
      }),
    )
    .toBe(true);
  receipts.linkThenFollow = {
    linked: 'choice-1',
    opened: 'choice-1',
    follows: 1,
    sourceDraftKept: true,
  };

  // 4c. A selected conversation stays: with it open, a press (even for a linked tab) only
  // opens the dock on it, its prompt focused and draft kept; no follow, no index.
  await press({ version: 'v1', url: A });
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a press over a selected conversation must not route
  await page.waitForTimeout(800);
  expect(await open()).toBe(origin);
  expect(await shortcutState()).toBeNull();
  await expect(composer).toContainText(DRAFT);
  receipts.selectedStays = { open: origin, routed: false };

  // 5. The linked snapshot publishes after the press: held (no index flash), then followed.
  await blank();
  await press({ version: 'v2', url: A });
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- the press waits for its version; nothing may change meanwhile
  await page.waitForTimeout(250);
  expect(await shortcutState()).toEqual({ destination: null, resolving: true });
  await observe('v2', A);
  await expect.poll(open).toBe('choice-1');
  receipts.latePublication = { heldWhileResolving: true, opened: 'choice-1' };

  // 5b. Ready but not yet linked at the press, then linked during the wait (as a late
  // service owner would): followed, never the index first.
  await blank();
  const L = 'https://github.com/example/late/issues/6';
  await observe('v6', L);
  await expect.poll(() => read().then((s) => s?.url)).toBe(L);
  await press({ version: 'v6', url: L });
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- the press is still waiting for a link on its version
  await page.waitForTimeout(300);
  expect(await shortcutState()).toEqual({ destination: null, resolving: true });
  await page.evaluate(() => (window as any).__dockComposerE2E.contextAction('link', 'choice-0'));
  await expect.poll(open).toBe('choice-0');
  receipts.lateLink = { heldWhileUnlinked: true, followed: 'choice-0' };

  // 6. A press for a version that never publishes (stale or moved on): the index, no follow.
  const follows = (await read())?.policy.follows;
  await blank();
  await press({ version: 'v-stale', url: A });
  await expect(overview).toBeVisible({ timeout: 5000 });
  expect(await open()).toBeNull();
  expect((await read())?.policy.follows).toBe(follows);
  receipts.stale = { index: true, opened: null, followsUnchanged: true };
  await leaveIndex();

  // 6b. Stale after seen: the press's version publishes for another tab. Nothing changes:
  // no index, no follow.
  await press({ version: 'v5', url: A });
  await observe('v5', 'https://github.com/example/elsewhere/issues/5');
  await expect.poll(() => read().then((s) => s?.contextVersion ?? '')).toContain('v5');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a stale press must not show the index or open anything
  await page.waitForTimeout(1800);
  expect(await shortcutState()).toBeNull();
  expect(await open()).toBeNull();

  // 6c. A pending media chooser (Window-menu Capture waiting for a workspace) is not taken over.
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.store.dispatch({
      type: 'dockConversation/shortcutChanged',
      payload: [
        {
          context: {
            id: 'menu-capture',
            backendId: h.store.state.connections.windowBackendId,
            action: 'capture',
          },
          destination: null,
          error: null,
          authority: null,
          resolving: false,
        },
      ],
    });
  });
  await press();
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: the press must leave the media chooser as it is
  await page.waitForTimeout(600);
  expect(
    await page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.shortcut?.context.id,
    ),
  ).toBe('menu-capture');
  await leaveIndex();
  receipts.staleAndChooser = { staleAfterSeen: 'no change', mediaChooserKept: true };

  // 7. An inferred owner (embedded tab of choice-2): pressing follows it; its header menu
  // offers This tab (not checked: nothing saved), which saves it; checked, it unlinks again.
  const C = 'https://github.com/example/embedded/pull/3';
  await observe('v3', C, 'choice-2');
  await expect.poll(() => read().then((s) => s?.linkedWorkspaceId)).toBe('choice-2');
  expect((await read())?.linkKey ?? null).toBeNull();
  await press({ version: 'v3', url: C });
  await expect.poll(open).toBe('choice-2');
  const link = page.locator('[data-dock-header-link]');
  const tabChoice = page.getByRole('menuitemcheckbox', { name: 'This tab' });
  await expect(link).not.toHaveAttribute('data-linked', /.*/);
  await link.click();
  await expect(tabChoice).toHaveAttribute('aria-checked', 'false');
  await tabChoice.click();
  await expect.poll(() => read().then((s) => s?.linkKey ?? null)).not.toBeNull();
  await expect(link).toHaveAttribute('data-linked', 'true');
  await page.screenshot({ path: info.outputPath('13-d-header-saved.png') });
  await link.click();
  await expect(tabChoice).toHaveAttribute('aria-checked', 'true');
  await tabChoice.click();
  await expect.poll(() => read().then((s) => s?.linkKey ?? null)).toBeNull();
  await expect(link).not.toHaveAttribute('data-linked', /.*/);
  // The inferred owner remains (unlink removes only the saved record).
  expect((await read())?.linkedWorkspaceId).toBe('choice-2');
  receipts.inferred = {
    followedInferred: 'choice-2',
    savedFromHeader: true,
    unlinkedFromHeader: true,
  };

  // 7b. A menu opened for one context closes, choosing nothing, when the context changes.
  await link.click();
  await expect(tabChoice).toBeVisible();
  const D2 = 'https://github.com/example/other/issues/77';
  await observe('v7', D2);
  await expect.poll(() => read().then((s) => s?.url)).toBe(D2);
  await expect(tabChoice).toBeHidden();
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a cancelled press must not save anything afterwards
  await page.waitForTimeout(600);
  expect((await read())?.linkKey ?? null).toBeNull();
  expect((await read())?.linkedWorkspaceId ?? null).toBeNull();
  receipts.heldGesture = { cancelledOnContextChange: true };
  await blank();

  // 8. Live input (push-to-talk recording): a press opens nothing and shows no index.
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({
      type: 'hardwareConsole/pttRecordingStarted',
      payload: [],
    }),
  );
  await press({ version: 'v3', url: C });
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: live input must leave the dock as it is
  await page.waitForTimeout(1800);
  expect(await open()).toBeNull();
  expect(await shortcutState()).toBeNull();
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({
      type: 'hardwareConsole/pttRecordingStopped',
      payload: [],
    }),
  );
  receipts.liveInput = { opened: null, index: false };

  // 9. Pressed again while the dock has the keyboard: close as Escape would.
  const closeBefore = await page.evaluate(
    () => (window as any).__dockComposerE2E.store.state.hud.dockCloseRequest,
  );
  await press(undefined, { toggleClose: true });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.hud.dockCloseRequest),
    )
    .toBe(closeBefore + 1);
  expect(await open()).toBeNull();
  receipts.toggleClose = { closeRequested: true };

  // 10. A press from another machine's backend is ignored.
  await press({ version: 'v3', url: C }, { backendId: 'another-machine' });
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a foreign press must not change anything
  await page.waitForTimeout(800);
  expect(await open()).toBeNull();
  expect(await shortcutState()).toBeNull();
  expect(await draftLength(origin)).toBe(DRAFT.length);
  receipts.foreignBackend = { ignored: true, draftKept: true };

  await writeFile(
    info.outputPath('single-shortcut-receipt.json'),
    JSON.stringify(
      {
        ...receipts,
        scope:
          'Real dock shortcut + context-links sagas in the notch shell (component harness); main press = window:focus-dock payload. Registry/prefs: real shared + main modules with a fake globalShortcut. No OS key delivery or native foreground sampling.',
      },
      null,
      2,
    ),
  );
});

/**
 * The header Link tooltip opens below the header, inside the dock and the viewport (never up
 * into the notch), wrapping a long name; normal and narrow viewports.
 */
test('header link tooltip opens below the header inside the dock', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.seedChoices(2);
    h.contextReady();
    h.context({
      sequence: 1,
      contextVersion: 't1',
      backendId: h.store.state.connections.windowBackendId,
      identityKey: 'url:https://github.com/example/tooltip/issues/1',
      identityKind: 'url',
      self: false,
      appId: 'com.apple.Safari',
      appName: 'Synthetic Safari',
      url: 'https://github.com/example/tooltip/issues/1',
      icon: null,
    });
    h.store.dispatch({ type: 'dockConversation/open', payload: ['choice-1'] });
  });
  const link = page.locator('[data-dock-header-link]');
  await expect(link).toBeVisible();
  const results: Record<string, unknown> = {};
  for (const [name, width] of [
    ['normal', 1000],
    ['narrow', 560],
  ] as const) {
    await page.setViewportSize({ width, height: 740 });
    // Rest the pointer on the header's title (inside the dock, off the button), then hover.
    const header = (await page.locator('[data-dock-chrome]').boundingBox())!;
    await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
    await link.hover();
    const tip = page.locator('[role="tooltip"]', { hasText: 'github.com' });
    await expect(tip).toBeVisible();
    const m = await page.evaluate(() => {
      const r = (el: Element | null) => {
        const b = el!.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
      };
      const tooltip = Array.from(document.querySelectorAll('[role="tooltip"]')).find((el) =>
        el.textContent?.includes('github.com'),
      )!;
      return {
        tooltip: r(tooltip),
        header: r(document.querySelector('[data-dock-chrome]')),
        trigger: r(document.querySelector('[data-dock-header-link]')),
        shell: r(document.querySelector('[data-testid="dock-shell"]')),
        viewport: window.innerWidth,
        text: tooltip.textContent?.trim(),
      };
    });
    // Below the trigger (never above the header, where the notch clips the window).
    expect(m.tooltip.top).toBeGreaterThanOrEqual(m.trigger.bottom - 0.5);
    expect(m.tooltip.top).toBeGreaterThan(m.header.top);
    expect(m.tooltip.left).toBeGreaterThanOrEqual(Math.max(0, m.shell.left) - 0.5);
    expect(m.tooltip.right).toBeLessThanOrEqual(Math.min(m.viewport, m.shell.right) + 0.5);
    expect(m.tooltip.width).toBeLessThanOrEqual(256.5);
    await page.screenshot({ path: info.outputPath(`16-header-tooltip-${name}.png`) });
    results[name] = m;
  }
  await writeFile(info.outputPath('header-tooltip-receipt.json'), JSON.stringify(results, null, 2));
});
