import { expect, test } from '@playwright/experimental-ct-svelte';
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

test('shows one selector for every stacked active pane type and none for one pane', async ({
  mount,
}) => {
  const component = await mount(PaneStackControlHost, {
    props: { paneTypes: ['agent'], stackCount: 1, initialActiveTabId: 'agent-pane' },
  });

  for (const type of panelTypes) {
    const fallback = type === 'note' ? 'browser' : 'note';
    await component.update({ props: { paneTypes: [type], stackCount: 1 } });
    await expect(component.getByTestId('pane-stack-selector-trigger')).toHaveCount(0);
    await component.update({ props: { paneTypes: [type, fallback], stackCount: 2 } });
    await expect(component.getByTestId('pane-stack-selector-trigger')).toHaveCount(1);
    await expect(component.locator('[data-panel-content-header]')).toHaveAttribute(
      'aria-label',
      'Pane stack size: 2',
    );
  }
});

test('keeps glyph geometry, action spacing, attention, and motion safe at 100% and 200%', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PaneStackControlHost, {
    props: {
      paneTypes: ['agent', 'note'],
      stackCount: 2,
      initialActiveTabId: 'agent-pane',
      attentionTabIds: ['note-pane'],
      width: 190,
    },
  });

  for (const zoom of [1, 2]) {
    await component.update({ props: { zoom } });
    const trigger = component.getByTestId('pane-stack-selector-trigger');
    await expect(trigger).toHaveAttribute('data-attention', '');
    const geometry = await component.locator('[data-panel-content-header]').evaluate((header) => {
      const identity = header.querySelector<HTMLElement>('[data-pane-stack-active]')!;
      const actions = header.querySelector<HTMLElement>('[data-panel-header-actions]')!;
      const glyph = header.querySelector<SVGElement>('[data-pane-stack-glyph]')!;
      const headerRect = header.getBoundingClientRect();
      const scale = headerRect.width / (header as HTMLElement).offsetWidth;
      const identityRect = identity.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const glyphRect = glyph.getBoundingClientRect();
      return {
        glyphWidth: glyphRect.width / scale,
        glyphHeight: glyphRect.height / scale,
        noCollision: identityRect.right <= actionsRect.left,
        actionsInside: actionsRect.right <= headerRect.right,
        lineCount: glyph.querySelectorAll('[data-pane-stack-line]').length,
      };
    });

    expect(geometry).toEqual({
      glyphWidth: 14,
      glyphHeight: 14,
      noCollision: true,
      actionsInside: true,
      lineCount: 2,
    });
  }

  await component.update({
    props: {
      paneTypes: panelTypes.slice(0, 7),
      stackCount: 7,
      attentionTabIds: [],
    },
  });
  await expect(component.locator('[data-pane-stack-glyph]')).toHaveAttribute(
    'data-pane-stack-visible-lines',
    '6',
  );
  await expect(component.locator('[data-pane-stack-line]')).toHaveCount(6);
});

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
