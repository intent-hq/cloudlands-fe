import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import ChatToolNavigationHarness from './mocks/ChatToolNavigationHarness.svelte';

type Variant = 'tool-file' | 'tool-note' | 'details-file' | 'details-note';

async function mountHarness(
  mount: Parameters<Parameters<typeof test>[1]>[0]['mount'],
  workspaceKey: string,
  variant: Variant,
  existingIdentity?: 'file' | 'note',
) {
  const component = await mount(ChatToolNavigationHarness, {
    props: { workspaceKey, variant, existingIdentity },
  });
  await expect(component).toHaveAttribute('data-chat-tool-navigation-ready', 'true');
  return { component, state: component.locator('[data-navigation-state]') };
}

async function expectRightmost(state: Locator, type: 'file' | 'note', value: string) {
  await expect(state).toHaveAttribute('data-panel-count', '2');
  await expect(state).toHaveAttribute('data-source-active-type', 'agent');
  await expect(state).toHaveAttribute('data-right-active-type', type);
  await expect(state).toHaveAttribute(
    type === 'file' ? 'data-right-active-path' : 'data-right-active-note',
    value,
  );
}

async function expectAdjacent(state: Locator, type: 'file' | 'note', value: string) {
  await expect(state).toHaveAttribute('data-panel-count', '3');
  await expect(state).toHaveAttribute('data-source-active-type', 'agent');
  await expect(state).toHaveAttribute('data-focused-active-type', type);
  await expect(state).toHaveAttribute(
    type === 'file' ? 'data-focused-active-path' : 'data-focused-active-note',
    value,
  );
}

async function expectExistingIdentity(
  state: Locator,
  workspaceKey: string,
  type: 'file' | 'note',
  value: string,
) {
  await expect(state).toHaveAttribute('data-panel-count', '3');
  await expect(state).toHaveAttribute('data-source-active-type', 'agent');
  await expect(state).toHaveAttribute('data-focused-panel-id', `existing-${workspaceKey}`);
  await expect(state).toHaveAttribute('data-existing-active-type', type);
  await expect(state).toHaveAttribute('data-identity-count', '1');
  await expect(state).toHaveAttribute(
    type === 'file' ? 'data-focused-active-path' : 'data-focused-active-note',
    value,
  );
  await expect(state).toHaveAttribute('data-right-active-path', 'src/existing.ts');
}

test('tool-call file mouse click opens in the rightmost column', async ({ mount }) => {
  const { component, state } = await mountHarness(mount, 'file-mouse', 'tool-file');
  await component.getByTestId('tool-call-file-link').click();
  await expectRightmost(state, 'file', 'src/tool.ts');
});

test('tool-call file keyboard activation opens in the rightmost column', async ({ mount }) => {
  const { component, state } = await mountHarness(mount, 'file-keyboard', 'tool-file');
  await component.getByTestId('tool-call-file-link').press('Enter');
  await expectRightmost(state, 'file', 'src/tool.ts');
});

test('tool-call file Command click creates an adjacent column', async ({ mount }) => {
  const { component, state } = await mountHarness(mount, 'file-command', 'tool-file');
  await component.getByTestId('tool-call-file-link').click({ modifiers: ['Meta'] });
  await expectAdjacent(state, 'file', 'src/tool.ts');
});

test('tool-call note mouse click opens in the rightmost column', async ({ mount }) => {
  const { component, state } = await mountHarness(mount, 'note-mouse', 'tool-note');
  await component.getByTestId('tool-call-note-link').click();
  await expectRightmost(state, 'note', 'note-1');
});

test('tool-call note keyboard activation opens in the rightmost column', async ({ mount }) => {
  const { component, state } = await mountHarness(mount, 'note-keyboard', 'tool-note');
  await component.getByTestId('tool-call-note-link').press('Enter');
  await expectRightmost(state, 'note', 'note-1');
});

test('tool-call note Control click creates an adjacent column', async ({ mount }) => {
  const { component, state } = await mountHarness(mount, 'note-control', 'tool-note');
  await component.getByTestId('tool-call-note-link').dispatchEvent('click', { ctrlKey: true });
  await expectAdjacent(state, 'note', 'note-1');
});

test('ordinary file open activates its existing identity without moving or duplicating it', async ({
  mount,
}) => {
  const workspaceKey = 'existing-file';
  const { component, state } = await mountHarness(mount, workspaceKey, 'tool-file', 'file');
  await component.getByTestId('tool-call-file-link').click();
  await expectExistingIdentity(state, workspaceKey, 'file', 'src/tool.ts');
});

test('ordinary note open activates its existing identity without moving or duplicating it', async ({
  mount,
}) => {
  const workspaceKey = 'existing-note';
  const { component, state } = await mountHarness(mount, workspaceKey, 'tool-note', 'note');
  await component.getByTestId('tool-call-note-link').click();
  await expectExistingIdentity(state, workspaceKey, 'note', 'note-1');
});

test('modified note open also reuses an existing identity instead of splitting', async ({
  mount,
}) => {
  const workspaceKey = 'existing-note-control';
  const { component, state } = await mountHarness(mount, workspaceKey, 'tool-note', 'note');
  await component.getByTestId('tool-call-note-link').dispatchEvent('click', { ctrlKey: true });
  await expectExistingIdentity(state, workspaceKey, 'note', 'note-1');
});

test('ToolDetails file and note links use the rightmost column', async ({ mount }) => {
  const file = await mountHarness(mount, 'details-file', 'details-file');
  await file.component
    .locator('[data-details-file] button')
    .filter({ hasText: 'details.ts' })
    .click();
  await expectRightmost(file.state, 'file', 'src/details.ts');
  await file.component.unmount();

  const note = await mountHarness(mount, 'details-note', 'details-note');
  await note.component
    .locator('[data-details-note] button')
    .filter({ hasText: 'Details note' })
    .click();
  await expectRightmost(note.state, 'note', 'details-note');
});
