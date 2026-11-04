import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockShortcutContext } from '$shared/dock-shortcuts';
type Fixture = {
  shortcut(context: DockShortcutContext): void;
  close(): void;
  store: {
    state: {
      connections: { windowBackendId: string };
      dockConversation: {
        shortcut?: { destination: string | null; context: DockShortcutContext };
        loading: boolean;
      };
    };
  };
  native: {
    log: {
      captures: number;
      annotations: unknown[];
      clips: { started: unknown[] };
      speech: { started: unknown[] };
    };
  };
};
async function send(
  page: import('@playwright/test').Page,
  action: DockShortcutContext['action'],
  extra: Partial<DockShortcutContext> = {},
) {
  await page.evaluate(
    ({ action, extra }) => {
      const h = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E;
      h.shortcut({
        id: crypto.randomUUID(),
        backendId: h.store.state.connections.windowBackendId,
        action,
        ...extra,
      });
    },
    { action, extra },
  );
}
async function home(page: import('@playwright/test').Page) {
  await page.getByTestId('dock-drag-handle').hover();
  await expect(page.getByTestId('dock-overview')).toBeVisible();
  await expect(page.getByText('Foreground app unavailable')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Just once', exact: true })).toHaveCount(0);
}
for (const action of ['focus', 'capture', 'record', 'annotate', 'dictate'] as const) {
  test(`${action}: unresolved shortcut uses ordinary home row exactly once`, async ({
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
    await send(page, action);
    await home(page);
    await page.screenshot({ path: info.outputPath(`${action}-home.png`) });
    const row = page
      .getByTestId('dock-overview')
      .getByRole('button', { name: /Connected companion fixture/ });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
              .dockConversation.shortcut?.destination,
        ),
      )
      .toBe('conversation-wire');
    const count = () =>
      page.evaluate((action) => {
        const l = (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native
          .log;
        return action === 'focus'
          ? 0
          : action === 'capture'
            ? l.captures
            : action === 'record'
              ? l.clips.started.length
              : action === 'annotate'
                ? l.annotations.length
                : l.speech.started.length;
      }, action);
    await expect.poll(count).toBe(action === 'focus' ? 0 : 1);
    await writeFile(
      info.outputPath(`${action}-home-action.json`),
      JSON.stringify(
        {
          action,
          boundary: 'Real home rows, store and sagas; synthetic daemon/native boundary.',
          log: await page.evaluate(
            () =>
              (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log,
          ),
        },
        null,
        2,
      ),
    );
  });
}
for (const cancel of ['close', 'escape', 'newer'] as const) {
  test(`${cancel} cancels obsolete capture before a later ordinary row click`, async ({
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
    await send(page, 'capture');
    await home(page);
    if (cancel === 'close')
      await page.evaluate(() =>
        (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.close(),
      );
    else if (cancel === 'escape') {
      await page
        .getByTestId('dock-overview')
        .getByRole('button', { name: /Connected companion fixture/ })
        .focus();
      await page.keyboard.press('Escape');
    } else await send(page, 'focus');
    if (cancel !== 'newer') await send(page, 'focus');
    await home(page);
    await page
      .getByTestId('dock-overview')
      .getByRole('button', { name: /Connected companion fixture/ })
      .click();
    await expect(page.getByTestId('dock-conversation-surface')).toBeVisible();
    const log = await page.evaluate(
      () => (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.native.log,
    );
    expect(log.captures).toBe(0);
    expect(log.clips.started).toHaveLength(0);
    await writeFile(info.outputPath(`${cancel}-cancelled.json`), JSON.stringify(log, null, 2));
  });
}
test('known focused-tab owner skips home, while 340px fallback uses the existing home', async ({
  mount,
  page,
}, info) => {
  const props = dockRailPreview.states.notch.props;
  await page.setViewportSize({ width: 672, height: 372 });
  await mount(Harness, {
    props: {
      shell: {
        ...props,
        viewportHeight: 340,
        floatingDisplay: {
          id: 1,
          bounds: { x: 0, y: 0, width: 640, height: 340 },
          workArea: { x: 0, y: 0, width: 640, height: 340 },
          cutout: props.placement!.cutout,
        },
        placement: {
          ...props.placement!,
          workArea: { x: 0, y: 0, width: 640, height: 340 },
          windowBounds: { ...props.placement!.windowBounds, height: 340 },
        },
      },
    },
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.loading,
      ),
    )
    .toBe(false);
  await send(page, 'focus', {
    workspaceId: 'conversation-wire',
    url: 'http://127.0.0.1:49954/synthetic',
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.shortcut?.destination,
      ),
    )
    .toBe('conversation-wire');
  await send(page, 'focus');
  await home(page);
  const row = page
    .getByTestId('dock-overview')
    .getByRole('button', { name: /Connected companion fixture/ });
  await expect(row).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('340px-home.png') });
  await writeFile(
    info.outputPath('340px-home.json'),
    JSON.stringify(
      {
        row: await row.boundingBox(),
        viewport: page.viewportSize(),
        customChooserCount: await page.getByTestId('dock-shortcut-routing').count(),
      },
      null,
      2,
    ),
  );
});

test('explicit workspace survives close and missing context, newer choice replaces it, owned preview wins', async ({
  mount,
  page,
}, info) => {
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.loading,
      ),
    )
    .toBe(false);
  await send(page, 'focus', { appId: 'synthetic.context' });
  await home(page);
  await page
    .getByTestId('dock-overview')
    .getByRole('button', { name: /Connected companion fixture/ })
    .click();
  await expect(page.getByTestId('dock-conversation-surface')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.close(),
  );
  await send(page, 'focus');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.shortcut?.destination,
      ),
    )
    .toBe('conversation-wire');
  await expect(page.getByTestId('dock-overview')).toHaveCount(0);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.seedChoices(2);
    h.close();
  });
  await home(page);
  await page
    .getByTestId('dock-overview')
    .getByRole('button', { name: /Synthetic workspace 0/ })
    .click();
  await send(page, 'focus');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.shortcut?.destination,
      ),
    )
    .toBe('choice-0');
  await send(page, 'focus', { workspaceId: 'choice-1', url: 'http://127.0.0.1:49954/project/' });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Fixture }).__dockComposerE2E.store.state
            .dockConversation.shortcut?.destination,
      ),
    )
    .toBe('choice-1');
  const evidence = await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    return {
      selection: h.store.state.dockConversation.shortcutSelection,
      destination: h.store.state.dockConversation.shortcut.destination,
      native: h.native.log,
    };
  });
  expect(evidence.selection.workspaceId).toBe('choice-0');
  expect(evidence.native.captures).toBe(0);
  expect(evidence.native.clips.started).toHaveLength(0);
  await writeFile(info.outputPath('retained-workspace.json'), JSON.stringify(evidence, null, 2));
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.archiveWorkspace('choice-0');
    h.close();
  });
  await send(page, 'focus');
  await home(page);
  await expect(
    page.getByTestId('dock-overview').getByRole('button', { name: /Synthetic workspace 0/ }),
  ).toHaveCount(0);
});

test('settled notch hover focuses the real editor once and preserves keyboard editing', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  const editor = page.locator('[data-testid="message-input"] [contenteditable="true"]');
  await page.getByTestId('dock-drag-handle').hover();
  await expect(editor).toBeVisible();
  await editor.fill('Keep this draft');
  await page.getByRole('region', { name: 'Messages', exact: true }).click();
  await page.mouse.move(850, 650);
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
  const commandsBefore = await page
    .locator('[data-preview-commands]')
    .getAttribute('data-preview-commands');
  await page.getByTestId('dock-drag-handle').hover();
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
  await expect(editor).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' safely');
  await expect(editor).toContainText('Keep this draft safely');
  const model = page.locator('[data-chat-input-primary-actions]').getByRole('button').first();
  await model.focus();
  await model.hover();
  await expect(model).toBeFocused();
  const commands = JSON.parse(
    (await page.locator('[data-preview-commands]').getAttribute('data-preview-commands')) ?? '[]',
  ) as { action: string }[];
  const before = JSON.parse(commandsBefore ?? '[]') as { action: string }[];
  expect(
    commands.filter((x) => x.action === 'focus').length -
      before.filter((x) => x.action === 'focus').length,
  ).toBe(1);
  await page.screenshot({ path: info.outputPath('hover-focused-composer.png') });
  await writeFile(
    info.outputPath('hover-keyboard-focus.json'),
    JSON.stringify(
      {
        boundary:
          'Real browser keyboard input and production focus controller; targeted native placement focus command recorded by synthetic shell.',
        text: await editor.innerText(),
        focusCommands: commands.filter((x) => x.action === 'focus').length,
        modelRetainedFocus: await model.evaluate((el) => el === document.activeElement),
      },
      null,
      2,
    ),
  );
});
