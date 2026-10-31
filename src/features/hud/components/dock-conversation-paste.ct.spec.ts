import type { Locator } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ConversationWireHarness from './DockConversationWireHarness.svelte';
import ConversationPreview from './dock-conversation.preview.svelte';
import { conversationAgents } from './dock-conversation.preview-fixtures';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const visibleNotices = '[data-dock-conversation-notifications] [data-dock-notice]';
// Reviewable banner captures land in the workspace artifact folder (monorepo root).

type Rect = { x: number; y: number; width: number; height: number };

async function expectBannerPlacement(component: Locator, banner: Locator) {
  const [box, composer, lane] = await Promise.all([
    banner.boundingBox(),
    component.locator('.conversation-footer').boundingBox(),
    component.locator('.conversation-footer .composer-prompt-lane').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left + Number.parseFloat(style.paddingLeft),
        right: rect.right - Number.parseFloat(style.paddingRight),
      };
    }),
  ]);
  if (!box || !composer) throw new Error('Missing banner or composer bounds');
  // Directly above the composer, in the composer lane, never covering the composer.
  expect(box.y + box.height).toBeLessThanOrEqual(composer.y + 1);
  expect(composer.y - (box.y + box.height)).toBeLessThan(2);
  expect(Math.abs(box.x - lane.left)).toBeLessThan(1);
  expect(Math.abs(box.x + box.width - lane.right)).toBeLessThan(1);
  // Native click-through: the banner is a registered pointer region.
  await expect
    .poll(async () => {
      const regions = JSON.parse((await component.getAttribute('data-regions')) ?? '[]') as Rect[];
      return regions.some(
        (r) =>
          r.x <= box.x + 1 &&
          r.y <= box.y + 1 &&
          r.x + r.width >= box.x + box.width - 1 &&
          r.y + r.height >= box.y + box.height - 1,
      );
    })
    .toBe(true);
}

async function pasteImage(editor: Locator, name: string, filesOnly: boolean) {
  await editor.evaluate(
    (element, { name, filesOnly, png }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(png), (character) => character.charCodeAt(0))], name, {
          type: 'image/png',
        }),
      );
      if (filesOnly) {
        // Keep the real FileList, but model a native bridge with no item entries.
        const files = transfer.files;
        Object.defineProperty(transfer, 'items', { value: new DataTransfer().items });
        Object.defineProperty(transfer, 'files', { value: files });
      }
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { name, filesOnly, png },
  );
}

async function calls(component: Locator) {
  return JSON.parse((await component.getAttribute('data-calls')) ?? '[]') as {
    method: string;
    params: Record<string, unknown>;
  }[];
}

async function expectNoSend(component: Locator) {
  expect(
    (await calls(component)).filter((call) =>
      ['agent.sendMessage', 'agent.queueMessage', 'file.placeAttachment'].includes(call.method),
    ),
  ).toEqual([]);
}

for (const filesOnly of [true, false]) {
  test(`dock image paste ${filesOnly ? 'with files only' : 'with items and files'} stages bytes without a success toast`, async ({
    mount,
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ConversationWireHarness, { props: { width: 320, height: 460 } });
    const editor = component.locator('[data-testid="message-input"] [contenteditable]');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.fill('Keep this draft unsent.');
    await pasteImage(editor, 'accepted.png', filesOnly);
    const thumbnail = component.getByRole('button', {
      name: 'View accepted.png full size',
      exact: true,
    });
    await expect(thumbnail).toHaveCount(1);
    await expect(thumbnail).toBeVisible();
    // The staged thumbnail is the feedback; a success toast would cover the compact transcript.
    await expect(component.locator(visibleNotices)).toHaveCount(0);
    await expect(editor).toHaveText('Keep this draft unsent.');
    await expect
      .poll(
        async () =>
          (await calls(component)).filter((call) => call.method === 'drafts.set').at(-1)?.params,
      )
      .toMatchObject({
        workspaceId: 'conversation-wire',
        agentId: 'wire-main',
        attachments: [
          expect.objectContaining({
            label: 'accepted.png',
            imageData: png,
            imageMimeType: 'image/png',
          }),
        ],
      });
    await expectNoSend(component);
    await component.screenshot({ path: info.outputPath('image-paste-feedback.png') });
  });
}

test('dock failed image read shows an error and accepts a later paste without losing the draft', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness);
  const editor = component.locator('[data-testid="message-input"] [contenteditable]');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Keep the original text.');
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      FileReader.prototype.readAsDataURL = original;
      if (file instanceof File && file.name === 'retry.png')
        throw new Error('Synthetic image read failed');
      return original.call(this, file);
    };
  });
  await pasteImage(editor, 'retry.png', true);
  const error = component.locator(visibleNotices);
  await expect(error).toHaveCount(1);
  await expect(error).toContainText('Failed to add image: retry.png');
  await expect(error).toBeInViewport({ ratio: 1 });
  await expect(error).toHaveAttribute('role', 'alert');
  await expectBannerPlacement(component, error);
  await component.screenshot({ path: test.info().outputPath('dock-banner-error.png') });
  await test.info().attach('dock-banner-error.png', {
    path: test.info().outputPath('dock-banner-error.png'),
    contentType: 'image/png',
  });
  await expect(
    component.getByRole('button', { name: 'View retry.png full size', exact: true }),
  ).toHaveCount(0);
  await expect(editor).toHaveText('Keep the original text.');
  await expectNoSend(component);
  await error.getByRole('button', { name: 'Close notification', exact: true }).click();
  await expect(component.locator(visibleNotices)).toHaveCount(0);
  await pasteImage(editor, 'retry.png', true);
  await expect(
    component.getByRole('button', { name: 'View retry.png full size', exact: true }),
  ).toBeVisible();
  await expect(component.locator(visibleNotices)).toHaveCount(0);
  await expect(editor).toHaveText('Keep the original text.');
  await expectNoSend(component);
});

test('dock image read completing after an agent switch cannot attach or notify in the new conversation', async ({
  mount,
  page,
}) => {
  const component = await mount(ConversationWireHarness);
  const editor = component.locator('[data-testid="message-input"] [contenteditable]');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Coordinator draft');
  const heldRead = await page.evaluateHandle(() => {
    const original = FileReader.prototype.readAsDataURL;
    let resume: (() => Promise<void>) | undefined;
    FileReader.prototype.readAsDataURL = function (file) {
      if (!(file instanceof File) || file.name !== 'late.png') return original.call(this, file);
      resume = () =>
        new Promise<void>((resolve) => {
          this.addEventListener('loadend', () => resolve(), { once: true });
          original.call(this, file);
        });
    };
    return {
      waiting: () => !!resume,
      release: async () => {
        if (!resume) throw new Error('No held image read');
        await resume();
      },
      dispose: () => {
        FileReader.prototype.readAsDataURL = original;
      },
    };
  });
  try {
    await pasteImage(editor, 'late.png', true);
    await expect.poll(() => heldRead.evaluate((read) => read.waiting())).toBe(true);
    const chooser = component.getByRole('combobox', { name: 'Conversation with' });
    await chooser.click();
    await page.getByRole('option', { name: 'Wire specialist', exact: true }).click();
    await expect(editor).toHaveText('');
    await editor.fill('Specialist draft');
    await heldRead.evaluate((read) => read.release());
    await expect(component.locator(visibleNotices)).toHaveCount(0);
    await expect(
      component.getByRole('button', { name: 'View late.png full size', exact: true }),
    ).toHaveCount(0);
    await expect(editor).toHaveText('Specialist draft');
    await chooser.click();
    await page.getByRole('option', { name: /Wire coordinator/ }).click();
    await expect(editor).toHaveText('Coordinator draft');
    await expect(
      component.getByRole('button', { name: 'View late.png full size', exact: true }),
    ).toHaveCount(0);
    expect(
      (await calls(component))
        .filter((call) => call.method === 'drafts.set')
        .some((call) => JSON.stringify(call.params.attachments ?? []).includes(png)),
    ).toBe(false);
    await expectNoSend(component);
  } finally {
    await heldRead.evaluate((read) => read.dispose());
    await heldRead.dispose();
  }
});

test('compact dock header keeps long names and keyboard agent selection usable at narrow width', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const agents = conversationAgents.map((agent, index) => ({
    ...agent,
    name:
      index === 0
        ? 'Design companion reviewing navigation across every workspace'
        : index === 1
          ? 'Implementation specialist for the expanded workspace conversation'
          : agent.name,
  }));
  const workspaceTitle = 'Workspace navigation and feedback across the whole desktop';
  const component = await mount(ConversationPreview, {
    props: {
      agent: agents[0],
      agents,
      workspaceTitle,
      width: 320,
      height: 520,
      initialDraft: 'Keep this draft while choosing an agent.',
    },
  });
  const header = component.locator('[data-slot="screen-header"]');
  const chooser = header.getByRole('combobox', { name: 'Conversation with', exact: true });
  const back = header.getByRole('button', { name: 'Go back', exact: true });
  const open = header.getByRole('button', { name: 'Open full conversation', exact: true });
  for (const control of [chooser, back, open]) await expect(control).toBeInViewport({ ratio: 1 });
  await expect(chooser.getByText(workspaceTitle, { exact: true })).toHaveAttribute(
    'title',
    workspaceTitle,
  );
  await expect(chooser.getByText(agents[0].name, { exact: true })).toHaveAttribute(
    'title',
    agents[0].name,
  );
  const headerBounds = await header.boundingBox();
  if (!headerBounds) throw new Error('Missing conversation header');
  for (const control of [back, chooser, open]) {
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error('Missing header control');
    expect(bounds.x).toBeGreaterThanOrEqual(headerBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(headerBounds.x + headerBounds.width);
  }
  await chooser.focus();
  await page.keyboard.press('Enter');
  const target = page.getByRole('option', { name: agents[1].name, exact: true });
  await expect(target).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(chooser).toBeFocused();
  await chooser.press('Enter');
  await target.click();
  await expect(chooser).toContainText(agents[1].name);
  await expect(chooser).toBeFocused();
  await chooser.press('Enter');
  await page.getByRole('option', { name: agents[0].name, exact: true }).click();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft while choosing an agent.',
  );
  await expect(chooser).toBeFocused();
  await component.screenshot({ path: info.outputPath('compact-conversation-header.png') });
});

test('dock banner shows one notice at a time with an inline action and keeps the transcript still', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness, { props: { width: 360, height: 460 } });
  const editor = component.locator('[data-testid="message-input"] [contenteditable]');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  const transcript = component.getByRole('region', { name: 'Messages', exact: true });
  const before = await transcript.boundingBox();
  await editor.fill('Original enhancement draft');
  // The dock footer has no '+' menu; Enhance prompt is reached through the app-wide
  // chat:enhance-prompt command (Cmd+/ and the command palette dispatch it).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('chat:enhance-prompt')));
  await expect
    .poll(async () =>
      (await calls(component)).some((call) => call.method === 'agent.enhancePrompt'),
    )
    .toBe(true);
  await component.getByRole('button', { name: 'Resolve synthetic enhancement' }).click();
  await expect(editor).toHaveText('Enhanced: Original enhancement draft');
  const banner = component.locator(visibleNotices);
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText('Prompt enhanced');
  const undo = banner.getByRole('button', { name: 'Undo enhance', exact: true });
  await expect(undo).toBeVisible();
  await expect(
    banner.getByRole('button', { name: 'Close notification', exact: true }),
  ).toBeVisible();
  await expectBannerPlacement(component, banner);
  // The banner overlays the transcript instead of resizing it.
  expect(await transcript.boundingBox()).toEqual(before);
  await component.screenshot({ path: test.info().outputPath('dock-banner-action.png') });
  await test.info().attach('dock-banner-action.png', {
    path: test.info().outputPath('dock-banner-action.png'),
    contentType: 'image/png',
  });

  // Success notices keep their auto-dismiss lifetime; Undo still works while shown.
  await undo.click();
  await expect(editor).toHaveText('Original enhancement draft');
  await expect(banner).toHaveCount(0);

  // A newer notice replaces the previous one rather than stacking behind it.
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      if (file instanceof File && file.name.startsWith('broken'))
        throw new Error('Synthetic image read failed');
      return original.call(this, file);
    };
  });
  await pasteImage(editor, 'broken-one.png', true);
  await expect(banner).toContainText('broken-one.png');
  await pasteImage(editor, 'broken-two.png', true);
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText('broken-two.png');
  await expect(banner).not.toContainText('broken-one.png');
  // Errors have no auto-dismiss; it is still shown past the 2s success lifetime.
  await page.waitForTimeout(2_500);
  await expect(banner).toHaveCount(1);
  expect(await transcript.boundingBox()).toEqual(before);
});
