import { expect, test } from '../../../../../test/ct-test';
import PaneStackControlHost from './mocks/PaneStackControlHost.svelte';

const panelTypes = [
  'agent',
  'browser',
  'terminal',
  'note',
  'file',
  'diff',
  'changes',
  'local-changes',
  'chat-changes',
  'settings',
  'overview',
  'hook-script',
  'activity',
  'activity-changes',
  'code-review',
  'agent-overview',
  'task',
] as const;

test('keeps the title selector available for single and stacked panes', async ({ mount }) => {
  const component = await mount(PaneStackControlHost, {
    props: { paneTypes: ['agent'], stackCount: 1, initialActiveTabId: 'agent-pane' },
  });

  for (const type of panelTypes) {
    const fallback = type === 'note' ? 'browser' : 'note';
    await component.update({ props: { paneTypes: [type], stackCount: 1 } });
    await expect(component.getByTestId('pane-stack-selector-trigger')).toHaveCount(1);
    await component.update({ props: { paneTypes: [type, fallback], stackCount: 2 } });
    await expect(component.getByTestId('pane-stack-selector-trigger')).toHaveCount(1);
    await expect(component.locator('[data-panel-content-header]')).toHaveAttribute(
      'aria-label',
      'Pane stack size: 2',
    );
  }
});

for (const zoom of [1, 2]) {
  test(`keeps the selector and actions reachable with attention at ${zoom * 100}%`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(PaneStackControlHost, {
      props: {
        paneTypes: ['agent', 'note'],
        stackCount: 2,
        initialActiveTabId: 'agent-pane',
        attentionTabIds: ['note-pane'],
        width: 190,
        zoom,
      },
    });

    const trigger = component.getByTestId('pane-stack-selector-trigger');
    await expect(trigger).toHaveAttribute('data-attention', '');
    const geometry = await component.locator('[data-panel-content-header]').evaluate((header) => {
      const identity = header.querySelector<HTMLElement>('[data-panel-header-identity]')!;
      const actions = header.querySelector<HTMLElement>('[data-panel-header-actions]')!;
      const headerRect = header.getBoundingClientRect();
      const identityRect = identity.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      return {
        rectangles: {
          header: headerRect.toJSON(),
          identity: identityRect.toJSON(),
          actions: actionsRect.toJSON(),
        },
        // Skinny agent headers intentionally wrap; shared x ranges alone are not a collision.
        noCollision:
          identityRect.right <= actionsRect.left ||
          actionsRect.right <= identityRect.left ||
          identityRect.bottom <= actionsRect.top ||
          actionsRect.bottom <= identityRect.top,
        contained: [identityRect, actionsRect].every(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= headerRect.left &&
            rect.right <= headerRect.right &&
            rect.top >= headerRect.top &&
            rect.bottom <= headerRect.bottom,
        ),
      };
    });

    await testInfo.attach(`header-geometry-${zoom}`, {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await testInfo.attach(`header-${zoom}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(geometry).toMatchObject({
      noCollision: true,
      contained: true,
    });

    await component.update({
      props: {
        paneTypes: panelTypes.slice(0, 7),
        stackCount: 7,
        attentionTabIds: [],
      },
    });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Panes in this stack' });
    await expect(menu.locator('[data-pane-stack-item]')).toHaveCount(7);
    await menu.locator('[data-pane-stack-item]').last().click();
    await expect(component).toHaveAttribute('data-active-tab', 'changes-pane');
  });
}

test('switches agent panes with keyboard-accessible menu identity and current state', async ({
  mount,
  page,
}) => {
  const component = await mount(PaneStackControlHost, {
    props: {
      paneTypes: ['agent', 'browser', 'terminal'],
      stackCount: 3,
      initialActiveTabId: 'agent-pane',
      attentionTabIds: ['browser-pane'],
    },
  });
  const trigger = component.getByTestId('pane-stack-selector-trigger');
  await trigger.focus();
  await trigger.press('Enter');
  const menu = page.getByRole('menu', { name: 'Panes in this stack' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-pane-stack-item="agent-pane"] [data-agent-avatar]')).toHaveCount(
    1,
  );
  await expect(menu.locator('[data-pane-stack-item="agent-pane"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    menu.getByRole('menuitem', { name: 'Preview browser. Needs attention.' }),
  ).toHaveAttribute('data-attention', '');
  await menu.getByRole('menuitem', { name: 'Preview browser. Needs attention.' }).click();
  await expect(component).toHaveAttribute('data-active-tab', 'browser-pane');
  await expect(menu).toHaveCount(0);
});
