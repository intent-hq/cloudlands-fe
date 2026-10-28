import { writeFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import ConversationPreview from './dock-conversation.preview.svelte';
import ConversationWireHarness from './DockConversationWireHarness.svelte';
import { dockRailPreview, adaptiveDockFixture } from './dock-rail.preview-fixtures';
import { dockConversationPreview } from './dock-conversation.preview-fixtures';
import {
  dockLocalRect,
  dockWindowEnvelope,
  resolveDockSurface,
  resolveFloatingDockGeometry,
  DOCK_FLOATING_COMPACT_SIZE,
  DOCK_FLOATING_SHADOW_MARGIN,
  type DockPlacementSnapshot,
  type DockDisplayGeometry,
} from '$shared/dock-placement';

const clipboardPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const evidence = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    fixture: Array.from(
      document.querySelectorAll('[data-calls], [data-regions], [data-preview-pointer]'),
    ).map((el) => ({
      calls: el.getAttribute('data-calls'),
      regions: el.getAttribute('data-regions'),
      pointer: el.getAttribute('data-preview-pointer'),
      placement: el.getAttribute('data-preview-placement'),
    })),
    elements: Array.from(
      document.querySelectorAll(
        '.model-picker-panel, [role="dialog"], [data-dock-scroll], [data-dock-row], [data-testid="dock-conversation-surface"]',
      ),
    ).map((el) => ({
      tag: el.tagName,
      testId: el.getAttribute('data-testid'),
      role: el.getAttribute('role'),
      classes: el.className,
      bounds: el.getBoundingClientRect().toJSON(),
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      focused: el === document.activeElement,
      insideOwnedPortal: !!el.closest('[data-dock-conversation-portals]'),
    })),
  }));
  await writeFile(testInfo.outputPath('failure-geometry.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: testInfo.outputPath('failure.png') });
});

async function transferImage(editor: Locator, name: string, kind: 'paste' | 'drop') {
  await editor.evaluate(
    (element, { name, kind, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: 'image/png' }));
      // Exercise browser FileReader and the production handlers; never the OS clipboard.
      element.dispatchEvent(
        kind === 'paste'
          ? new ClipboardEvent('paste', {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { name, kind, base64: clipboardPng },
  );
}

test('conversation stays dark with light or system app preferences and keeps narrow popups reachable', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 380, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  const component = await mount(ConversationWireHarness, {
    props: {
      width: 320,
      height: 520,
      notchChrome: true,
      dockAppearance: true,
      initialMessage: 'Review the `main` branch before continuing.',
    },
  });
  const editor = component.locator('[data-testid="message-input"] [contenteditable]');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Keep the conversation close while I review the changes.');
  const composerChrome: unknown[] = [];
  const readChrome = () =>
    editor.evaluate((el) => {
      const frames = [];
      let node: HTMLElement | null = el as HTMLElement;
      while (node && !node.hasAttribute('data-dock-conversation-composer')) {
        const style = getComputedStyle(node);
        frames.push({
          border: ['Top', 'Right', 'Bottom', 'Left'].map((side) => {
            const width = style.getPropertyValue(`border-${side.toLowerCase()}-width`);
            const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
            return parseFloat(width) > 0 && kind !== 'none' && kind !== 'hidden'
              ? `${width} ${kind} ${style.getPropertyValue(`border-${side.toLowerCase()}-color`)}`
              : 'unpainted';
          }),
          outline:
            parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none'
              ? style.outline
              : 'unpainted',
          shadow: style.boxShadow,
          background: style.backgroundColor,
        });
        node = node.parentElement;
      }
      return frames;
    });
  for (const theme of ['light', 'system', 'dark']) {
    await component.getByRole('button', { name: `Use ${theme} app preference` }).click();
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
    await expect(editor).toHaveCSS('color-scheme', 'dark');
    const code = component.locator('[data-dock-conversation] code').filter({ hasText: 'main' });
    await expect(code).toBeVisible();
    const readable = async (target: Locator) =>
      target.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const ancestors: Element[] = [];
        let node: Element | null = element;
        while (node) {
          ancestors.unshift(node);
          node = node.parentElement;
        }
        let background = [255, 255, 255];
        for (const ancestor of ancestors) {
          const layer = rgba(getComputedStyle(ancestor).backgroundColor);
          background = background.map(
            (value, i) => (layer[i] * layer[3]) / 255 + value * (1 - layer[3] / 255),
          );
        }
        const foreground = rgba(getComputedStyle(element).color);
        const paintedText = background.map(
          (value, i) => (foreground[i] * foreground[3]) / 255 + value * (1 - foreground[3] / 255),
        );
        const luminance = (color: number[]) =>
          color.reduce((sum, channel, i) => {
            const v = channel / 255;
            return (
              sum +
              (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) *
                [0.2126, 0.7152, 0.0722][i]
            );
          }, 0);
        const values = [luminance(paintedText), luminance(background)].sort((a, b) => b - a);
        return { ratio: (values[0] + 0.05) / (values[1] + 0.05), foreground, background };
      });
    const picker = component.getByRole('combobox', { name: 'Conversation with' });
    for (const [label, target] of [
      ['inline code', code],
      ['agent picker', picker],
    ] as const) {
      await expect
        .poll(async () => (await readable(target)).ratio, {
          message: `${label} stays readable in the dark dock with ${theme} app preference`,
        })
        .toBeGreaterThanOrEqual(4.5);
    }
    await writeFile(
      testInfo.outputPath(`readability-${theme}.json`),
      JSON.stringify(
        {
          code: await readable(code),
          picker: await readable(picker),
        },
        null,
        2,
      ),
    );
    await component.getByRole('combobox', { name: 'Conversation with' }).focus();
    const idle = await readChrome();
    await component
      .getByTestId('dock-conversation-surface')
      .screenshot({ path: testInfo.outputPath(`composer-${theme}-idle.png`) });
    await editor.focus();
    await expect(editor).toBeFocused();
    // Requested contract: editor focus must not add another painted boundary.
    await expect.poll(readChrome).toEqual(idle);
    await component
      .getByTestId('dock-conversation-surface')
      .screenshot({ path: testInfo.outputPath(`composer-${theme}-focused.png`) });
    composerChrome.push({ theme, idle, focused: await readChrome() });
  }
  const aurora = component.getByTestId('composer-aurora-host');
  await expect(aurora).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await component.getByRole('button', { name: 'Start synthetic stream', exact: true }).click();
  await expect(aurora.locator('canvas')).toBeVisible();
  await expect(aurora).toHaveCSS('pointer-events', 'none');
  await aurora.evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await editor.click();
  await expect(editor).toBeFocused();
  await component
    .getByTestId('dock-conversation-surface')
    .screenshot({ path: testInfo.outputPath('composer-aurora-streaming.png') });
  const clipping = await aurora.evaluate((el) => {
    const surface = el.closest('[data-testid="dock-conversation-surface"]');
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (
        ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) &&
        ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
      ) {
        const rect = node.getBoundingClientRect();
        const bounds = surface?.getBoundingClientRect();
        if (
          bounds &&
          rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1 &&
          rect.top >= bounds.top - 1 &&
          rect.bottom <= bounds.bottom + 1
        )
          return true;
      }
      node = node.parentElement;
    }
    return false;
  });
  expect(clipping).toBe(true);
  await component.getByRole('button', { name: 'Disable Aurora preference', exact: true }).click();
  await expect(aurora).toHaveCount(0);
  await component.getByRole('button', { name: 'Enable Aurora preference', exact: true }).click();
  await expect(aurora.locator('canvas')).toBeVisible();
  await component
    .getByRole('button', { name: 'Toggle synthetic surface activity', exact: true })
    .click();
  await expect(aurora).toHaveCount(0);
  await component
    .getByRole('button', { name: 'Toggle synthetic surface activity', exact: true })
    .click();
  await expect(aurora.locator('canvas')).toBeVisible();
  await component.getByRole('button', { name: 'End synthetic stream', exact: true }).click();
  await expect(aurora).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeFile(
    testInfo.outputPath('composer-chrome.json'),
    JSON.stringify(composerChrome, null, 2),
  );
  await editor.fill('');

  const assertPopup = async (popup: Locator) => {
    await expect(popup).toBeVisible();
    await expect(popup).toHaveCSS('color-scheme', 'dark');
    await expect
      .poll(async () => {
        const b = await popup.boundingBox();
        const regions = JSON.parse((await component.getAttribute('data-regions')) ?? '[]') as {
          x: number;
          y: number;
          width: number;
          height: number;
        }[];
        return (
          !!b &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= 380 &&
          b.y + b.height <= 680 &&
          regions.some(
            (r) =>
              r.x <= b.x + 1 &&
              r.y <= b.y + 1 &&
              r.x + r.width >= b.x + b.width - 1 &&
              r.y + r.height >= b.y + b.height - 1,
          )
        );
      })
      .toBe(true);
  };
  const modelTrigger = component
    .locator('[data-chat-input-primary-actions]')
    .getByRole('button')
    .first();
  await modelTrigger.click();
  await assertPopup(page.locator('.model-picker-panel'));
  await page.keyboard.press('Escape');
  await expect(page.locator('.model-picker-panel')).toHaveCount(0);
  await expect(modelTrigger).toBeFocused();
  const actions = component.getByTestId('prompt-actions-trigger');
  await actions.click();
  const addContext = page.getByRole('menuitem', { name: 'Add Context', exact: false });
  await addContext.focus();
  await addContext.press('ArrowRight');
  const context = page.getByRole('dialog', { name: 'Select context panels', exact: true });
  await assertPopup(context);
  await page.screenshot({ path: testInfo.outputPath('conversation-nested-context.png') });
  await page.keyboard.press('Escape');
  await expect(context).toHaveCount(0);
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(component.getByTestId('dock-conversation-surface')).toBeVisible();
  await editor.fill('');
  await editor.pressSequentially('@');
  await assertPopup(page.locator('.mention-popup'));
  await page.keyboard.press('Escape');
  await expect(page.locator('.mention-popup')).toHaveCount(0);
  await expect(editor).toBeFocused();
  await editor.fill('A multiline draft');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('Second line');
  await editor.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  });
  expect(
    JSON.parse((await component.getAttribute('data-calls')) ?? '[]').filter(
      (call: { method: string }) => call.method === 'agent.sendMessage',
    ),
  ).toHaveLength(0);
  await expect(component.locator('.composer-hint')).toHaveCount(0);
  expect(
    await editor.evaluate((element) =>
      (element.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .every((id) => document.getElementById(id) !== null),
    ),
  ).toBe(true);
  const chooser = component.getByRole('combobox', { name: 'Conversation with' });
  const switchTo = async (name: string) => {
    await chooser.click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(chooser).toContainText(name);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
  };
  const enhance = async () => {
    await actions.click();
    await page.getByRole('menuitem', { name: 'Enhance prompt', exact: true }).click();
  };
  await editor.fill('Original enhancement draft');
  await enhance();
  await expect
    .poll(
      async () =>
        JSON.parse((await component.getAttribute('data-calls')) ?? '[]').filter(
          (call: { method: string }) => call.method === 'agent.enhancePrompt',
        ).length,
    )
    .toBe(1);
  await switchTo('Wire specialist');
  await switchTo('Wire coordinator');
  await editor.fill('Newer reopened draft');
  await component.getByRole('button', { name: 'Resolve synthetic enhancement' }).click();
  await expect(editor).toHaveText('Newer reopened draft');
  await enhance();
  await expect
    .poll(
      async () =>
        JSON.parse((await component.getAttribute('data-calls')) ?? '[]').filter(
          (call: { method: string }) => call.method === 'agent.enhancePrompt',
        ).length,
    )
    .toBe(2);
  await component.getByRole('button', { name: 'Resolve synthetic enhancement' }).click();
  await expect(editor).toHaveText('Enhanced: Newer reopened draft');
  const staleUndo = component
    .locator('[data-dock-conversation-notifications]')
    .getByRole('button', { name: 'Undo enhance', exact: true });
  await expect(staleUndo).toBeVisible();
  await switchTo('Wire specialist');
  await switchTo('Wire coordinator');
  await editor.fill('Keep this reopened draft');
  await staleUndo.click();
  await expect(editor).toHaveText('Keep this reopened draft');
});

test('conversation canonical composer preserves image drafts and retries one exact image send', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationWireHarness, {
    props: { width: 320, height: 460, failPlacementOnce: true },
  });
  const editor = component.locator('[data-testid="message-input"] [contenteditable]');
  const submit = component.getByTestId('composer-submit-button');
  const calls = async () =>
    JSON.parse((await component.getAttribute('data-calls')) ?? '[]') as {
      method: string;
      params: Record<string, unknown>;
    }[];
  const sends = async () =>
    (await calls()).filter(
      (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
    );
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Inspect the pasted diagram');
  await transferImage(editor, 'diagram.png', 'paste');
  const input = component.locator('[data-dock-conversation-composer]');
  const thumbnail = input.getByRole('button', {
    name: 'View diagram.png full size',
    exact: true,
  });
  await expect(thumbnail).toBeVisible();
  const notice = component
    .locator(
      '[data-dock-conversation-notifications] [data-sonner-toast]:not([data-removed="true"]):not([data-visible="false"]):not([inert])',
    )
    .last();
  await expect(notice).toBeVisible();
  await expect
    .poll(async () => {
      const n = await notice.boundingBox();
      const p = await component.getByTestId('dock-conversation-surface').boundingBox();
      const regions = JSON.parse((await component.getAttribute('data-regions')) ?? '[]') as {
        x: number;
        y: number;
        width: number;
        height: number;
      }[];
      return (
        !!n &&
        !!p &&
        n.x >= p.x &&
        n.y >= p.y &&
        n.x + n.width <= p.x + p.width + 1 &&
        n.y + n.height <= p.y + p.height + 1 &&
        regions.some(
          (r) =>
            r.x <= n.x + 1 &&
            r.y <= n.y + 1 &&
            r.x + r.width >= n.x + n.width - 1 &&
            r.y + r.height >= n.y + n.height - 1,
        )
      );
    })
    .toBe(true);
  await thumbnail.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      // The backdrop is deliberately not a native hit region. The actual image,
      // zoom controls and close action must remain reachable.
      const boxes = await dialog
        .locator('button, [role="slider"], [data-media-lightbox-content]')
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()));
      const regions = JSON.parse((await component.getAttribute('data-regions')) ?? '[]') as {
        x: number;
        y: number;
        width: number;
        height: number;
      }[];
      return (
        boxes.length > 0 &&
        boxes.every((box) =>
          regions.some(
            (r) =>
              r.x <= box.x + 1 &&
              r.y <= box.y + 1 &&
              r.x + r.width >= box.x + box.width - 1 &&
              r.y + r.height >= box.y + box.height - 1,
          ),
        )
      );
    })
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  const chooser = component.getByRole('combobox', { name: 'Conversation with' });
  await chooser.click();
  await page.getByRole('option', { name: 'Wire specialist', exact: true }).click();
  await expect(editor).toHaveText('');
  await expect(thumbnail).toHaveCount(0);
  await editor.fill('Specialist text');
  await transferImage(editor, 'specialist.png', 'drop');
  const specialist = component.getByRole('button', {
    name: 'View specialist.png full size',
    exact: true,
  });
  await expect(specialist).toBeVisible();
  await specialist.hover();
  await component.getByRole('button', { name: 'Remove specialist.png', exact: true }).click();
  await expect(specialist).toHaveCount(0);
  await chooser.click();
  await page.getByRole('option', { name: /Wire coordinator/ }).click();
  await expect(editor).toHaveText('Inspect the pasted diagram');
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(async () =>
      (await calls()).some(
        (call) =>
          call.method === 'drafts.set' &&
          call.params.agentId === 'wire-main' &&
          JSON.stringify(call.params.attachments).includes(clipboardPng),
      ),
    )
    .toBe(true);
  await expect(submit).toBeEnabled();
  await submit.click();
  const retry = component.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeEnabled();
  await expect(component.getByText(/Synthetic image placement rejected/).first()).toBeVisible();
  expect(await sends()).toHaveLength(0);
  await expect(thumbnail).toBeVisible();
  await expect(editor).toHaveText('Inspect the pasted diagram');
  await component.screenshot({ path: testInfo.outputPath('conversation-placement-error.png') });
  await retry.click();
  await expect.poll(async () => (await sends()).length).toBe(1);
  // Admission clears the actual editor and attachment draft while the daemon
  // acknowledgement is deliberately held by this fixture.
  await expect(editor).toHaveText('');
  await expect(thumbnail).toHaveCount(0);
  const first = (await sends())[0].params;
  expect(first).toMatchObject({
    workspaceId: 'conversation-wire',
    agentId: 'wire-main',
    content: 'Inspect the pasted diagram',
    imageBlocks: [
      {
        type: 'image',
        attachmentId: '04591a54-6b26-4b9d-8f62-000000000001',
        mimeType: 'image/png',
      },
    ],
  });
  const placed = (await calls()).filter((call) => call.method === 'file.placeAttachment');
  expect(placed).toHaveLength(2);
  expect(placed[0].params).toMatchObject({
    workspaceId: 'conversation-wire',
    data: clipboardPng,
    mimeType: 'image/png',
  });
  expect(placed[1].params).toMatchObject({
    workspaceId: placed[0].params.workspaceId,
    data: clipboardPng,
    mimeType: 'image/png',
  });
  if (placed[0].params.idempotencyKey !== undefined)
    expect(placed[1].params).toEqual(placed[0].params);
  await editor.press('Enter');
  expect(await sends()).toHaveLength(1);
  await component.getByRole('button', { name: 'Reject synthetic delivery', exact: true }).click();
  await expect(retry).toBeEnabled();
  await expect(editor).toHaveText('Inspect the pasted diagram');
  await expect(thumbnail).toBeVisible();
  await retry.click();
  await expect.poll(async () => (await sends()).length).toBe(2);
  await expect(editor).toHaveText('');
  await expect(thumbnail).toHaveCount(0);
  expect((await sends())[1].params).toMatchObject({
    content: first.content,
    imageBlocks: first.imageBlocks,
    workspaceId: first.workspaceId,
    agentId: first.agentId,
  });
  expect((await calls()).filter((call) => call.method === 'file.placeAttachment')).toHaveLength(2);
  const newerText = Array.from(
    { length: 18 },
    (_, index) => `Draft line ${index + 1}: keep the newer image and reply.`,
  ).join('\n');
  await editor.fill(newerText);
  await transferImage(editor, 'newer.png', 'paste');
  const newer = input.getByRole('button', { name: 'View newer.png full size', exact: true });
  await expect(newer).toBeVisible();
  await component.getByRole('button', { name: 'Accept synthetic delivery', exact: true }).click();
  await expect(submit).toBeEnabled();
  await expect(editor).toHaveText(newerText, { useInnerText: true });
  await expect(newer).toBeVisible();
  await expect(component.locator('.composer-hint')).toHaveCount(0);
  const fit = await component.getByTestId('dock-conversation-surface').evaluate((panel) => {
    const p = panel.getBoundingClientRect();
    return [
      ...panel.querySelectorAll(
        '[data-testid="composer-submit-button"], [data-testid="message-input"]',
      ),
    ].every((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= p.left - 1 && r.right <= p.right + 1 && r.top >= p.top && r.bottom <= p.bottom
      );
    });
  });
  expect(fit).toBe(true);
  await component.screenshot({ path: testInfo.outputPath('conversation-image-draft.png') });
  await component.getByTestId('prompt-actions-trigger').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('conversation-rich-narrow-options.png') });
  await page.keyboard.press('Escape');
  // Attachment-only submission clears before acknowledgement too. A later
  // rejection must not replace text/images typed after that admission.
  await editor.fill('');
  await submit.click();
  await expect.poll(async () => (await sends()).length).toBe(3);
  expect((await sends())[2]).toMatchObject({
    method: 'agent.queueMessage',
    params: {
      workspaceId: 'conversation-wire',
      agentId: 'wire-main',
      content: '',
      imageBlocks: [
        {
          type: 'image',
          attachmentId: '04591a54-6b26-4b9d-8f62-000000000002',
          mimeType: 'image/png',
        },
      ],
    },
  });
  await expect(editor).toHaveText('');
  await expect(newer).toHaveCount(0);
  await editor.fill('Preserve my next reply after rejection');
  await transferImage(editor, 'after-rejection.png', 'paste');
  const afterRejection = input.getByRole('button', {
    name: 'View after-rejection.png full size',
    exact: true,
  });
  await expect(afterRejection).toBeVisible();
  await component.getByRole('button', { name: 'Reject synthetic delivery', exact: true }).click();
  await expect(retry).toBeEnabled();
  await expect(editor).toHaveText('Preserve my next reply after rejection');
  await expect(afterRejection).toBeVisible();
  await expect(newer).toHaveCount(0);
  await component.screenshot({
    path: testInfo.outputPath('conversation-newer-draft-rejection.png'),
  });
  await writeFile(
    testInfo.outputPath('conversation-image-wire.json'),
    JSON.stringify(
      {
        scope:
          'Production composer, surface, client and saga owners; synthetic clipboard/files/daemon only. DOM regions, not physical native routing.',
        calls: await calls(),
        regions: JSON.parse((await component.getAttribute('data-regions')) ?? '[]'),
      },
      null,
      2,
    ),
  );
});

for (const mode of ['notch', 'side-left', 'side-right'] as const) {
  test(`conversation ${mode} full workspace list scrolls and Back reveals its origin`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 640 });
    const side = mode === 'side-left' ? 'left' : 'right';
    const isSide = mode !== 'notch';
    await page.emulateMedia({ reducedMotion: isSide ? 'no-preference' : 'reduce' });
    const props = dockRailPreview.states[mode].props;
    const workspaces = dockRailPreview.states['floating-overflow'].props.workspaces;
    expect(workspaces.length).toBeGreaterThan(5);
    const display: DockDisplayGeometry = {
      id: 1,
      bounds: { x: -640, y: -80, width: 640, height: 480 },
      workArea: { x: -640, y: -80, width: 640, height: 480 },
      cutout: null,
    };
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        workspaces,
        conversationFixture: true,
        ...(isSide ? { floatingDisplay: display } : {}),
      },
    });
    if (!isSide) await component.getByTestId('dock-drag-handle').hover();
    const entries = component.locator(isSide ? '[data-dock-entry]' : '[data-dock-row]');
    const scroller = component.locator('[data-dock-scroll]');
    await expect(entries).toHaveCount(workspaces.length + 1);
    await expect(component.getByTestId('dock-overflow-button')).toHaveCount(0);
    await expect(component.getByTestId('dock-overview-footer')).toHaveCount(0);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);
    await scroller.hover();
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // Keyboard navigation must reveal the target itself, without a test scrollIntoView call.
    await entries.first().focus();
    await entries.first().press('End');
    const last = entries.last();
    await expect(last).toBeFocused();
    const visible = async () =>
      last.evaluate((el) => {
        const scroll = el.closest('[data-dock-scroll]');
        if (!scroll) return false;
        const r = el.getBoundingClientRect(),
          s = scroll.getBoundingClientRect();
        return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
      });
    await expect.poll(visible).toBe(true);
    const targetId = String(workspaces[workspaces.length - 1].workspace.id);
    await last.press('Enter');
    const panel = component.getByTestId('dock-conversation-surface');
    await expect(panel).toHaveAttribute('data-workspace-id', targetId);
    await panel.getByRole('button', { name: 'Go back', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(last).toBeFocused();
    await expect.poll(visible).toBe(true);
    if (isSide) {
      await last.hover();
      await expect
        .poll(async () => Number(await last.getAttribute('data-dock-scale')))
        .toBeGreaterThan(1);
      await expect
        .poll(async () =>
          Number(await entries.nth(workspaces.length - 1).getAttribute('data-dock-scale')),
        )
        .toBeGreaterThan(1);
      const card = component.getByTestId('dock-preview');
      await expect(card).toHaveAttribute('data-preview-workspace-id', targetId);
      await expect
        .poll(() =>
          component.evaluate((root) => {
            const rail = root.querySelector('[data-dock-scroll]');
            const host = root.querySelector('.dock-preview-host');
            if (!rail || !host) return false;
            const clip = rail.getBoundingClientRect(),
              bounds = host.getBoundingClientRect();
            const regions = JSON.parse(root.getAttribute('data-preview-pointer') ?? '{}')
              .regions as { x: number; y: number; width: number; height: number }[] | undefined;
            if (!regions?.length) return false;
            const contained = regions.every(
              (r) =>
                r.x >= bounds.left - 1 &&
                r.y >= bounds.top - 1 &&
                r.x + r.width <= bounds.right + 1 &&
                r.y + r.height <= bounds.bottom + 1,
            );
            const covered = [...rail.querySelectorAll('[data-dock-entry]')].every((entry) => {
              const b = entry.getBoundingClientRect();
              const left = Math.max(b.left, clip.left),
                right = Math.min(b.right, clip.right);
              const top = Math.max(b.top, clip.top),
                bottom = Math.min(b.bottom, clip.bottom);
              if (right <= left || bottom <= top) return true;
              return regions.some(
                (r) =>
                  r.x <= left + 1 &&
                  r.y <= top + 1 &&
                  r.x + r.width >= right - 1 &&
                  r.y + r.height >= bottom - 1,
              );
            });
            return contained && covered;
          }),
        )
        .toBe(true);
      const iconBox = await last.boundingBox(),
        cardBox = await card.boundingBox();
      if (!iconBox || !cardBox) throw new Error('Missing scrolled icon or hovercard');
      const center = iconBox.y + iconBox.height / 2;
      expect(center).toBeGreaterThanOrEqual(cardBox.y);
      expect(center).toBeLessThanOrEqual(cardBox.y + cardBox.height);
      await page.mouse.move(
        side === 'left' ? cardBox.x + 4 : cardBox.x + cardBox.width - 4,
        center,
        { steps: 8 },
      );
      await expect(card).toBeVisible();
      await card.getByTestId('dock-row-feedback').click();
    } else {
      await last.hover();
      await component
        .locator(`[data-testid="dock-row-feedback"][data-workspace-id="${targetId}"]`)
        .click();
    }
    await expect(component).toHaveAttribute('data-preview-action', `feedback:${targetId}`);
    await component.screenshot({ path: testInfo.outputPath(`workspace-scroll-${mode}.png`) });
  });
}

if (process.env.DOCK_CONVERSATION_DEMO === '1') {
  test.use({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    video: { mode: 'on', size: { width: 1280, height: 800 } },
  });
  test.describe('conversation handoff capture', () => {
    test('real-speed compact conversation walkthrough', async ({ mount, page }, testInfo) => {
      await page.addStyleTag({
        content: '[data-dock-rail-preview] { margin: 60px auto; } body { background: #171717; }',
      });
      const props = dockRailPreview.states.notch.props;
      const component = await mount(DockRailPreview, {
        props: {
          ...props,
          workspaces: props.workspaces.slice(0, 2),
          placement: adaptiveDockFixture('floating'),
          conversationFixture: true,
          theme: 'dark',
        },
      });
      // Capture pacing only; verification uses settled assertions rather than timed frames.
      await page.waitForTimeout(1000);
      await component.getByTestId('dock-drag-handle').hover();
      const row = component.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
      await expect(row).toBeVisible();
      await page.waitForTimeout(1000);
      await row.click();
      const panel = component.getByTestId('dock-conversation-surface');
      await expect(panel).toBeVisible();
      await page.mouse.move(1000, 700);
      await page.waitForTimeout(1800);
      const composer = panel.getByRole('textbox', { name: 'Message', exact: true });
      await composer.pressSequentially('Keep my place while I switch agents.', { delay: 45 });
      await page.waitForTimeout(1000);
      const chooser = panel.getByRole('combobox', { name: 'Conversation with' });
      await chooser.click();
      await page.waitForTimeout(900);
      await page.getByRole('option', { name: 'Navigation specialist', exact: true }).click();
      await expect(composer).toHaveValue('');
      await composer.pressSequentially('Check the keyboard path next.', { delay: 45 });
      await page.waitForTimeout(1000);
      await chooser.click();
      await page.waitForTimeout(800);
      await page.getByRole('option', { name: 'Workspace coordinator', exact: true }).click();
      await expect(composer).toHaveValue('Keep my place while I switch agents.');
      await composer.focus();
      await page.waitForTimeout(1500);
      await component.screenshot({ path: testInfo.outputPath('conversation-final.png') });
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(row).toBeFocused();
      await page.waitForTimeout(1400);
      await writeFile(
        testInfo.outputPath('demo-scope.json'),
        JSON.stringify(
          {
            scope:
              'Real shell/panel, controlled workspace and draft callbacks; UI walkthrough only, no daemon/native send',
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 2,
          },
          null,
          2,
        ),
      );
    });
  });
}

test('conversation wire hydrates and keeps a newer draft across delayed acceptance', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(ConversationWireHarness);
  const root = component;
  const composer = component.locator('[data-testid="message-input"] [contenteditable]');
  const calls = async () =>
    JSON.parse((await root.getAttribute('data-calls')) ?? '[]') as {
      method: string;
      params: Record<string, unknown>;
    }[];
  try {
    await expect(composer).toBeEnabled();
  } catch (error) {
    await writeFile(
      testInfo.outputPath('wire-load-failure.json'),
      JSON.stringify(await calls(), null, 2),
    );
    await component.screenshot({ path: testInfo.outputPath('wire-load-failure.png') });
    throw error;
  }
  await expect(component.getByRole('combobox', { name: 'Conversation with' })).toContainText(
    'Wire coordinator',
  );
  await expect(component.getByText('Live history for wire-main', { exact: true })).toBeVisible();
  await component.getByRole('button', { name: 'Publish synthetic reply', exact: true }).click();
  await expect(component.getByText('Fresh daemon notification', { exact: true })).toBeVisible();
  await composer.fill('First correlated request');
  await expect(component.getByTestId('composer-submit-button')).toBeEnabled();
  await composer.press('Enter');
  try {
    await expect
      .poll(
        async () => (await calls()).filter((call) => call.method === 'agent.sendMessage').length,
      )
      .toBe(1);
  } catch (error) {
    await writeFile(
      testInfo.outputPath('wire-send-failure.json'),
      JSON.stringify(
        {
          calls: await calls(),
          state: JSON.parse((await root.getAttribute('data-diagnostic')) ?? '{}'),
        },
        null,
        2,
      ),
    );
    throw error;
  }
  await expect(composer).toBeEnabled();
  // Local admission clears the editor while the synthetic daemon still holds
  // its acknowledgement; the submitted prompt remains in the pending message.
  await expect(composer).toHaveText('');
  await expect(
    component
      .getByRole('region', { name: 'Messages', exact: true })
      .getByText('First correlated request', { exact: true }),
  ).toBeVisible();
  await composer.fill('Newer draft must survive the old acknowledgement');
  await composer.press('Enter');
  expect((await calls()).filter((call) => call.method === 'agent.sendMessage')).toHaveLength(1);
  await component.getByRole('button', { name: 'Accept synthetic delivery', exact: true }).click();
  await expect(component.getByTestId('composer-submit-button')).toBeEnabled();
  await expect(composer).toHaveText('Newer draft must survive the old acknowledgement');
  const chooser = component.getByRole('combobox', { name: 'Conversation with' });
  await chooser.click();
  await page.getByRole('option', { name: 'Wire specialist', exact: true }).click();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveText('');
  await composer.fill('Independent specialist draft');
  await chooser.click();
  await page.getByRole('option', { name: /Wire coordinator/ }).click();
  await expect(composer).toHaveText('Newer draft must survive the old acknowledgement');
  await component.getByRole('button', { name: 'Open full conversation', exact: true }).click();
  await expect(root).toHaveAttribute('data-full-target', 'conversation-wire:wire-main');
  const wire = await calls();
  const sends = wire.filter((call) => call.method === 'agent.sendMessage');
  expect(sends).toHaveLength(1);
  expect(sends[0].params).toMatchObject({
    workspaceId: 'conversation-wire',
    agentId: 'wire-main',
    messageId: expect.any(String),
  });
  expect(JSON.stringify(sends[0].params)).toContain('First correlated request');
  expect(wire.some((call) => call.method === 'chat.subscribe')).toBe(true);
  await component.screenshot({ path: testInfo.outputPath('conversation-wire.png') });
  await writeFile(
    testInfo.outputPath('conversation-wire.json'),
    JSON.stringify(
      {
        scope: 'Real client/store/sagas; synthetic daemon IPC and notifications; no live send',
        wire,
      },
      null,
      2,
    ),
  );
});

for (const side of ['left', 'right'] as const) {
  test(`conversation ${side} rail pins exact workspace and retains agent drafts`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const height = side === 'left' ? 720 : 460;
    const display: DockDisplayGeometry = {
      id: 1,
      bounds: { x: -640, y: -80, width: 640, height },
      workArea: { x: -640, y: -80, width: 640, height },
      cutout: null,
    };
    const base = adaptiveDockFixture('edge', side);
    const rail = resolveDockSurface(base.placement, display, { width: 40, height: 144 });
    const windowBounds = dockWindowEnvelope(rail, display, null, side);
    const placement = {
      ...base,
      windowBounds,
      surface: dockLocalRect(rail, windowBounds),
      sidePanel: null,
    };
    const props = dockRailPreview.states[`side-${side}`].props;
    const workspaces = props.workspaces.slice(0, 2);
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        workspaces,
        placement,
        floatingDisplay: display,
        conversationFixture: true,
        theme: side === 'left' ? 'dark' : 'light',
      },
    });
    const first = component.locator(`[data-dock-entry="${workspaces[0].workspace.id}"]`);
    const second = component.locator(`[data-dock-entry="${workspaces[1].workspace.id}"]`);
    await first.hover();
    await expect(component.getByTestId('dock-preview')).toBeVisible();
    await expect(component.getByTestId('dock-conversation-surface')).toHaveCount(0);
    const railPosition = async () => {
      const snapshot = JSON.parse(
        (await component.getAttribute('data-preview-placement')) ?? 'null',
      );
      return {
        x: snapshot.surface.x + snapshot.windowBounds.x,
        y: snapshot.surface.y + snapshot.windowBounds.y,
        width: snapshot.surface.width,
        height: snapshot.surface.height,
      };
    };
    const initial = await railPosition();
    await first.click();
    const panel = component.getByTestId('dock-conversation-surface');
    await expect(panel).toHaveAttribute('data-workspace-id', String(workspaces[0].workspace.id));
    await expect(component.getByTestId('dock-preview')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Go back', exact: true })).toBeFocused();
    const composer = panel.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Keep the coordinator draft');
    const chooser = panel.getByRole('combobox', { name: 'Conversation with' });
    await chooser.click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeVisible();
    await expect(chooser).toBeFocused();
    await chooser.click();
    await page.getByRole('option', { name: 'Navigation specialist', exact: true }).click();
    await expect(composer).toHaveValue('');
    await composer.fill('Specialist draft');
    await page.mouse.move(940, 700);
    await expect(composer).toBeFocused();
    await expect(panel).toBeVisible();
    await panel.getByRole('region', { name: 'Messages', exact: true }).click();
    await expect(composer).not.toBeFocused();
    await expect(panel).toBeVisible();
    await page.mouse.move(940, 700);
    await expect(panel).not.toBeVisible();
    await first.hover();
    await expect(panel).toBeVisible();
    await expect(chooser).toContainText('Navigation specialist');
    await expect(composer).toHaveValue('Specialist draft');
    await second.click();
    await expect(panel).toHaveAttribute('data-workspace-id', String(workspaces[1].workspace.id));
    await expect(composer).toHaveValue('');
    await first.click();
    await expect(composer).toHaveValue('Specialist draft');
    await panel.getByRole('button', { name: 'Open full conversation', exact: true }).click();
    await expect(component).toHaveAttribute(
      'data-preview-action',
      `full-chat:${workspaces[0].workspace.id}:${workspaces[0].workspace.id}:sub`,
    );
    await chooser.click();
    await page.getByRole('option', { name: 'Workspace coordinator', exact: true }).click();
    await expect(composer).toHaveValue('Keep the coordinator draft');
    await composer.press('Shift+Enter');
    await expect(component).toHaveAttribute('data-preview-submissions', '[]');
    await composer.dispatchEvent('compositionstart');
    await composer.press('Enter');
    await expect(component).toHaveAttribute('data-preview-submissions', '[]');
    await composer.dispatchEvent('compositionend');
    await composer.fill('One deliberate reply');
    await composer.press('Enter');
    await expect
      .poll(async () =>
        JSON.parse((await component.getAttribute('data-preview-submissions')) ?? '[]'),
      )
      .toEqual([
        {
          workspaceId: String(workspaces[0].workspace.id),
          agentId: `${workspaces[0].workspace.id}:main`,
          text: 'One deliberate reply',
        },
      ]);
    await expect(composer).toHaveValue('');
    await expect
      .poll(async () =>
        component.evaluate((root) => {
          const host = root.querySelector<HTMLElement>('.dock-preview-host');
          const panel = root.querySelector<HTMLElement>(
            '[data-testid="dock-conversation-surface"]',
          );
          const composer = root.querySelector<HTMLElement>('[data-dock-conversation-composer]');
          if (!host || !panel || !composer) return false;
          const h = host.getBoundingClientRect(),
            p = panel.getBoundingClientRect(),
            c = composer.getBoundingClientRect();
          const state = JSON.parse(root.getAttribute('data-preview-pointer') ?? '{}');
          return (
            p.left >= h.left &&
            p.right <= h.right &&
            p.top >= h.top &&
            p.bottom <= h.bottom &&
            c.top >= p.top &&
            c.bottom <= p.bottom &&
            state.regions?.some(
              (r: { x: number; y: number; width: number; height: number }) =>
                Math.abs(r.x - (p.x - h.x)) < 1 &&
                Math.abs(r.y - (p.y - h.y)) < 1 &&
                Math.abs(r.width - p.width) < 1 &&
                Math.abs(r.height - p.height) < 1,
            )
          );
        }),
      )
      .toBe(true);
    const after = await railPosition();
    expect(after).toEqual(initial);
    await component.screenshot({ path: testInfo.outputPath(`conversation-${side}.png`) });
    await composer.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(first).toBeFocused();
    await expect
      .poll(async () =>
        JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').some(
          (command: { action: string }) => command.action === 'dismiss',
        ),
      )
      .toBe(false);
    const assistant = component.locator('[data-dock-entry="dock:assistant"]');
    await assistant.click();
    await expect(panel).toHaveAttribute('data-workspace-id', '__chief__');
    await panel.getByRole('button', { name: 'Go back', exact: true }).click();
    await expect(assistant).toBeFocused();
    await writeFile(
      testInfo.outputPath(`conversation-${side}.json`),
      JSON.stringify(
        {
          scope: 'Real shell and panel with presentation-only fake callbacks; no wire/native claim',
          initial,
          after,
          commands: await component.getAttribute('data-preview-commands'),
          actions: await component.getAttribute('data-preview-actions'),
          submissions: await component.getAttribute('data-preview-submissions'),
        },
        null,
        2,
      ),
    );
  });
}

test('conversation horizontal collapse preserves drafts and restores origin in notch and floating modes', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const shape of ['notch', 'floating'] as const) {
    const props = dockRailPreview.states.notch.props;
    const component = await mount(DockRailPreview, {
      props: {
        ...props,
        workspaces: props.workspaces.slice(0, 2),
        placement: adaptiveDockFixture(shape),
        conversationFixture: true,
      },
    });
    await component.getByTestId('dock-drag-handle').hover();
    const row = component.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
    await row.hover();
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    const expandedWidth = (await component.getByTestId('dock-surface').boundingBox())?.width;
    if (!expandedWidth) throw new Error('Expanded overview missing');
    const assertSharedWidth = () =>
      expect
        .poll(async () =>
          Math.abs(
            ((await component.getByTestId('dock-surface').boundingBox())?.width ?? 0) -
              expandedWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
    await expect(component.getByTestId('dock-conversation-surface')).toHaveCount(0);
    await row.click();
    const panel = component.getByTestId('dock-conversation-surface');
    await expect(panel).toHaveAttribute('data-workspace-id', '__chief__');
    await assertSharedWidth();
    const composer = panel.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Retain this reply');
    await page.mouse.move(900, 680);
    await expect(composer).toBeFocused();
    await expect(panel).toBeVisible();
    await expect(component.getByTestId('dock-overview')).toHaveCount(0);
    await panel.getByRole('region', { name: 'Messages', exact: true }).click();
    await expect(composer).not.toBeFocused();
    await expect(panel).toBeVisible();
    await page.mouse.move(900, 680);
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
    await expect(component.locator('.overview-frame')).toHaveAttribute('inert', '');
    await expect(component.locator('.overview-frame')).toHaveAttribute('aria-hidden', 'true');
    await expect(component.locator('.overview-frame')).toHaveCSS('opacity', '0');
    await component.getByTestId('dock-drag-handle').hover();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-workspace-id', '__chief__');
    await expect(composer).toHaveValue('Retain this reply');
    await component.screenshot({ path: testInfo.outputPath(`conversation-${shape}.png`) });
    await panel.getByRole('button', { name: 'Go back', exact: true }).click();
    await expect(row).toBeFocused();
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    await assertSharedWidth();
    await page.mouse.move(900, 680);
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
    await component.getByTestId('dock-drag-handle').hover();
    await row.hover();
    const workspaceRow = component.locator('[data-dock-row]').nth(1);
    const workspaceId = await workspaceRow.getAttribute('data-workspace-id');
    await workspaceRow.click();
    await expect(panel).toHaveAttribute('data-workspace-id', workspaceId!);
    await assertSharedWidth();
    await panel.getByRole('button', { name: 'Go back', exact: true }).click();
    await expect(workspaceRow).toBeFocused();
    await assertSharedWidth();
    await row.focus();
    await row.press('Enter');
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Retain this reply',
    );
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(row).toBeFocused();
    await component.unmount();
  }
});

for (const scene of [
  {
    name: 'center-down',
    side: false,
    x: 0.5,
    y: 0.12,
    height: 760,
    edge: 'se',
    dx: -24,
    dy: -20,
  },
  { name: 'right-up', side: false, x: 1, y: 0.88, height: 760, edge: 'nw', dx: 24, dy: 20 },
  { name: 'side-bottom', side: true, x: 0, y: 0.9, height: 760, edge: 'ne', dx: -24, dy: 20 },
  { name: 'short-up', side: false, x: 0.5, y: 0.88, height: 400, edge: 'w', dx: 24, dy: 0 },
  {
    name: 'rejected',
    side: false,
    x: 0.5,
    y: 0.12,
    height: 760,
    edge: 'se',
    dx: -24,
    dy: -20,
    ack: 'reject',
  },
  {
    name: 'late-ack',
    side: false,
    x: 0.5,
    y: 0.12,
    height: 760,
    edge: 'se',
    dx: -24,
    dy: -20,
    ack: 'defer',
  },
] as const) {
  test(`conversation resize follows the dragged edge: ${scene.name}`, async ({
    mount,
    page,
  }, testInfo) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 1100, height: 850 });
    const evidence: unknown[] = [];

    await page.mouse.move(1080, 830);
    await page.emulateMedia({
      reducedMotion: scene.name === 'short-up' ? 'reduce' : 'no-preference',
    });
    const display: DockDisplayGeometry = {
      id: 1,
      bounds: { x: -1200, y: -100, width: 1000, height: scene.height },
      workArea: { x: -1200, y: -76, width: 1000, height: scene.height - 48 },
      cutout: null,
    };
    const target = scene.side
      ? { kind: 'edge' as const, displayId: 1, side: 'left' as const, along: scene.y }
      : { kind: 'floating' as const, displayId: 1, x: scene.x, y: scene.y };
    const floating =
      target.kind === 'floating'
        ? resolveFloatingDockGeometry(target, display, DOCK_FLOATING_COMPACT_SIZE)
        : null;
    const core =
      floating?.surface ?? resolveDockSurface(target, display, { width: 40, height: 144 });
    const windowBounds = dockWindowEnvelope(
      core,
      display,
      null,
      scene.side ? 'left' : null,
      true,
      scene.side ? 24 : DOCK_FLOATING_SHADOW_MARGIN,
    );
    const snapshot: DockPlacementSnapshot = {
      ...adaptiveDockFixture(scene.side ? 'edge' : 'floating', 'left'),
      placement: target,
      windowBounds,
      surface: dockLocalRect(core, windowBounds),
      workArea: dockLocalRect(display.workArea, windowBounds),
      ...(floating
        ? {
            floatingAnchor: dockLocalRect(floating.anchor, windowBounds),
            expansionDirection: floating.expansionDirection,
          }
        : {}),
    };
    const component = await mount(DockRailPreview, {
      props: {
        ...dockRailPreview.states[scene.side ? 'side-left' : 'floating'].props,
        placement: snapshot,
        floatingDisplay: display,
        conversationFixture: true,
        resizeAcknowledgement: 'ack' in scene ? scene.ack : 'accept',
        viewportWidth: 1000,
        viewportHeight: scene.height,
      },
    });
    if (!scene.side) await component.getByTestId('dock-drag-handle').hover();
    await component
      .locator(scene.side ? '[data-dock-entry]' : '[data-dock-row]')
      .first()
      .click();
    const panel = component.getByTestId('dock-conversation-surface');
    const editor = panel.getByRole('textbox', { name: 'Message', exact: true });
    await editor.fill('Keep this reply through resize');
    const rect = async () => {
      const value = await panel.boundingBox();
      if (!value) throw new Error('Conversation panel missing');
      return value;
    };
    await expect
      .poll(async () => {
        const state = JSON.parse((await component.getAttribute('data-preview-placement')) ?? '{}');
        const current = await rect();
        return Math.abs(
          current.width - (scene.side ? state.sidePanel?.width : state.surface?.width),
        );
      })
      .toBeLessThanOrEqual(1);
    const before = await rect();
    const handle = panel.locator(`[data-dock-resize="${scene.edge}"]`);
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Resize handle missing');
    const point = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await writeFile(
      testInfo.outputPath(`resize-${scene.name}-start.json`),
      JSON.stringify(
        {
          scene,
          before,
          point,
          atDown: await rect(),
          placement: JSON.parse((await component.getAttribute('data-preview-placement')) ?? '{}'),
        },
        null,
        2,
      ),
    );

    if ('ack' in scene) {
      await page.mouse.move(point.x + scene.dx, point.y + scene.dy, { steps: 4 });
      await page.mouse.up();
      if (scene.ack === 'defer') {
        await page.evaluate(() => window.dispatchEvent(new Event('dock-preview-resize-ack')));
        await expect
          .poll(
            async () =>
              JSON.parse((await component.getAttribute('data-preview-commands')) ?? '[]').filter(
                (c: { action: string }) => c.action === 'cancel-resize',
              ).length,
          )
          .toBe(1);
      }
      await expect(handle).toHaveAttribute('data-resizing', 'false');
      await expect
        .poll(
          async () =>
            JSON.parse((await component.getAttribute('data-preview-placement')) ?? '{}')
              .resizeToken ?? null,
        )
        .toBeNull();
      await expect
        .poll(async () => Math.abs((await rect()).width - before.width))
        .toBeLessThanOrEqual(1);
      await expect
        .poll(async () => Math.abs((await rect()).height - before.height))
        .toBeLessThanOrEqual(1);
      await expect(editor).toHaveValue('Keep this reply through resize');
      evidence.push({ scene, before, after: await rect() });
      await component.unmount();
      return;
    }
    await expect
      .poll(
        async () =>
          JSON.parse((await component.getAttribute('data-preview-placement')) ?? '{}').resizeToken,
      )
      .toBeTruthy();
    await page.mouse.move(point.x + scene.dx, point.y + scene.dy, { steps: 4 });
    const edgeX = (r: typeof before) => (scene.edge.includes('w') ? r.x : r.x + r.width);
    const edgeY = (r: typeof before) => (scene.edge.includes('n') ? r.y : r.y + r.height);
    await expect
      .poll(async () => Math.abs(edgeX(await rect()) - edgeX(before) - scene.dx))
      .toBeLessThanOrEqual(1);
    if (scene.dy)
      await expect
        .poll(async () => Math.abs(edgeY(await rect()) - edgeY(before) - scene.dy))
        .toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          JSON.parse((await component.getAttribute('data-preview-placement')) ?? '{}')
            .resizeToken ?? null,
      )
      .toBeNull();
    const resized = await rect();
    await expect(editor).toHaveValue('Keep this reply through resize');

    // Escape cancels only the current resize, preserving the selected conversation.
    const cancelBox = await handle.boundingBox();
    if (!cancelBox) throw new Error('Resize handle missing after resize');
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      cancelBox.x + cancelBox.width / 2 - scene.dx / 2,
      cancelBox.y + cancelBox.height / 2 - scene.dy / 2,
      { steps: 2 },
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(panel).toBeVisible();
    await expect
      .poll(async () => Math.abs((await rect()).width - resized.width))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => Math.abs((await rect()).height - resized.height))
      .toBeLessThanOrEqual(1);
    await expect(editor).toHaveValue('Keep this reply through resize');

    const keyboardHandle = panel.locator('[data-dock-resize][tabindex="0"]');
    await keyboardHandle.focus();
    const keyboardEdge = (await keyboardHandle.getAttribute('data-dock-resize')) ?? '';
    await keyboardHandle.press(keyboardEdge.includes('w') ? 'ArrowRight' : 'ArrowLeft');
    await expect
      .poll(async () => Math.abs((await rect()).width - (resized.width - 10)))
      .toBeLessThanOrEqual(1);
    await expect(keyboardHandle).toBeFocused();
    const remembered = await rect();
    // Core regions are snapshot-local; detached panel regions come from measured
    // DOM bounds. The display preview offsets its fake native window, so translate
    // only the measured-region expectation by that host offset (zero in Electron).
    await expect
      .poll(async () => {
        const placement = JSON.parse(
          (await component.getAttribute('data-preview-placement')) ?? '{}',
        );
        const host = await component.locator('.dock-preview-host').boundingBox();
        const expected =
          scene.side && host
            ? {
                ...placement.sidePanel,
                x: placement.sidePanel.x + host.x,
                y: placement.sidePanel.y + host.y,
              }
            : placement.surface;
        const regions =
          JSON.parse((await component.getAttribute('data-preview-pointer')) ?? '{}').regions ?? [];
        return (
          !!expected &&
          regions.some(
            (r: { x: number; y: number; width: number; height: number }) =>
              Math.abs(r.x - expected.x) < 1 &&
              Math.abs(r.y - expected.y) < 1 &&
              Math.abs(r.width - expected.width) < 1 &&
              Math.abs(r.height - expected.height) < 1,
          )
        );
      })
      .toBe(true);
    const regions =
      JSON.parse((await component.getAttribute('data-preview-pointer')) ?? '{}').regions ?? [];
    const placement = JSON.parse((await component.getAttribute('data-preview-placement')) ?? '{}');
    const expected = scene.side ? placement.sidePanel : placement.surface;
    const host = await component.locator('.dock-preview-host').boundingBox();
    if (!host) throw new Error('Native envelope preview missing');
    expect(remembered.x - host.x).toBeGreaterThanOrEqual(expected.x - 1);
    expect(remembered.y - host.y).toBeGreaterThanOrEqual(expected.y - 1);
    expect(remembered.x - host.x + remembered.width).toBeLessThanOrEqual(
      expected.x + expected.width + 1,
    );
    expect(remembered.y - host.y + remembered.height).toBeLessThanOrEqual(
      expected.y + expected.height + 1,
    );
    for (const box of await panel
      .locator('[data-dock-resize]')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(remembered.x - 1);
      expect(box.right).toBeLessThanOrEqual(remembered.x + remembered.width + 1);
      expect(box.top).toBeGreaterThanOrEqual(remembered.y - 1);
      expect(box.bottom).toBeLessThanOrEqual(remembered.y + remembered.height + 1);
    }
    await component.screenshot({
      path: testInfo.outputPath(`conversation-resize-${scene.name}.png`),
    });
    await panel.getByRole('button', { name: 'Go back', exact: true }).click();
    if (!scene.side) {
      // Leave the real pointer at Back's former position while the upward panel
      // shrinks. Wait beyond disclosure grace to distinguish geometry-only leave
      // from the next intentional mouse movement.
      await page.waitForTimeout(350);
      await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
      await component.screenshot({
        path: testInfo.outputPath(`conversation-back-${scene.name}.png`),
      });
      await expect
        .poll(async () =>
          Math.abs(
            ((await component.getByTestId('dock-surface').boundingBox())?.width ?? 0) -
              remembered.width,
          ),
        )
        .toBeLessThanOrEqual(1);
      const workspaceRow = component.locator('[data-dock-row]').nth(1);
      await workspaceRow.click();
      await expect
        .poll(async () => Math.abs((await rect()).width - remembered.width))
        .toBeLessThanOrEqual(1);
      await panel.getByRole('button', { name: 'Go back', exact: true }).click();
    }
    await component
      .locator(scene.side ? '[data-dock-entry]' : '[data-dock-row]')
      .first()
      .press('Enter');
    await expect(editor).toHaveValue('Keep this reply through resize');
    await expect
      .poll(async () => Math.abs((await rect()).width - remembered.width))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => Math.abs((await rect()).height - remembered.height))
      .toBeLessThanOrEqual(1);
    evidence.push({ scene, before, resized, remembered, regions });
    await component.unmount();
    await writeFile(
      testInfo.outputPath('conversation-resize.json'),
      JSON.stringify(
        {
          scope:
            'Real renderer and production geometry with fake native acknowledgement; no Electron or physical input routing proof',
          evidence,
        },
        null,
        2,
      ),
    );
  });
}

test('conversation preserves an auto-unarchived notice-only transcript', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationPreview, {
    props: {
      width: 320,
      height: 460,
      theme: 'dark',
      messages: [
        {
          id: 'notice-only-unarchived',
          role: 'system',
          timestamp: '2026-10-28T00:00:00Z',
          metadata: { type: 'auto_unarchived', reason: 'agent_activity' },
          contentBlocks: [{ type: 'text', text: 'This workspace resumed after a new message.' }],
        },
      ],
    },
  });
  const row = component.locator('[data-dock-message-id="notice-only-unarchived"]');
  await expect(row).toHaveAttribute('data-dock-message-role', 'system');
  await expect(row.getByRole('status')).toContainText('Workspace was automatically unarchived');
  await expect(row.getByRole('status')).toBeVisible();
  await component.screenshot({ path: testInfo.outputPath('conversation-notice-only.png') });
});

test('conversation preserves mixed system rows and block-metadata notices in transcript order', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ConversationPreview, {
    props: {
      width: 420,
      height: 820,
      theme: 'dark',
      messages: [
        {
          id: 'mixed-user',
          role: 'user',
          timestamp: '2026-10-28T00:00:00Z',
          contentBlocks: [{ type: 'text', text: 'Resume the review.' }],
        },
        {
          id: 'mixed-unarchived',
          role: 'system',
          timestamp: '2026-10-28T00:00:01Z',
          metadata: { type: 'auto_unarchived', reason: 'agent_activity' },
          contentBlocks: [{ type: 'text', text: 'Workspace resumed.' }],
        },
        {
          id: 'mixed-assistant',
          role: 'assistant',
          timestamp: '2026-10-28T00:00:02Z',
          contentBlocks: [{ type: 'text', text: 'The review has resumed.' }],
        },
        {
          id: 'mixed-dismissed',
          role: 'system',
          timestamp: '2026-10-28T00:00:03Z',
          metadata: { type: 'questions_dismissed', dismissedQuestionsMessageId: 'questions-one' },
          contentBlocks: [{ type: 'text', text: 'First questions dismissed.' }],
        },
        {
          id: 'mixed-model',
          role: 'system',
          timestamp: '2026-10-28T00:00:04Z',
          metadata: { type: 'model_changed', from: 'before-model', to: 'after-model' },
          contentBlocks: [{ type: 'text', text: 'Model changed.' }],
        },
        {
          id: 'mixed-block-dismissed',
          role: 'system',
          timestamp: '2026-10-28T00:00:05Z',
          contentBlocks: [
            {
              type: 'text',
              text: 'Second questions dismissed.',
              messageMetadata: {
                type: 'questions_dismissed',
                dismissedQuestionsMessageId: 'questions-two',
              },
            },
          ],
        },
        {
          id: 'mixed-plain-system',
          role: 'system',
          timestamp: '2026-10-28T00:00:06Z',
          contentBlocks: [{ type: 'text', text: 'A plain system update remains visible.' }],
        },
        {
          id: 'mixed-user-followup',
          role: 'user',
          timestamp: '2026-10-28T00:00:07Z',
          contentBlocks: [{ type: 'text', text: 'Continue from here.' }],
        },
      ],
    },
  });
  await expect(component.getByText('Resume the review.', { exact: true })).toBeVisible();
  await expect(component.getByText('The review has resumed.', { exact: true })).toBeVisible();
  await expect(
    component.locator('[data-dock-message-id="mixed-unarchived"]').getByRole('status'),
  ).toBeVisible();
  for (const id of ['mixed-dismissed', 'mixed-block-dismissed']) {
    await expect(
      component.locator(`[data-dock-message-id="${id}"]`).getByRole('status'),
    ).toHaveText('Questions dismissed');
  }
  await expect(component.locator('[data-dock-message-id="mixed-model"]')).toContainText(
    'after-model',
  );
  await expect(
    component.getByText('A plain system update remains visible.', { exact: true }),
  ).toBeVisible();
  await expect(component.getByText('Continue from here.', { exact: true })).toBeVisible();
  const rows = await component.locator('[data-dock-message-id]').evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.getAttribute('data-dock-message-id'),
      role: element.getAttribute('data-dock-message-role'),
    })),
  );
  expect(rows).toEqual([
    { id: 'mixed-user', role: 'user' },
    { id: 'mixed-unarchived', role: 'system' },
    { id: 'mixed-assistant', role: 'assistant' },
    { id: 'mixed-dismissed', role: 'system' },
    { id: 'mixed-model', role: 'system' },
    { id: 'mixed-block-dismissed', role: 'system' },
    { id: 'mixed-plain-system', role: 'system' },
    { id: 'mixed-user-followup', role: 'user' },
  ]);
  await writeFile(
    testInfo.outputPath('conversation-system-row-order.json'),
    JSON.stringify(rows, null, 2),
  );
  await component.screenshot({ path: testInfo.outputPath('conversation-system-row-order.png') });
});

test('conversation canonical transcript keeps wake details collapsed and queue separate', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const props = dockConversationPreview.states.structured.props;
  const component = await mount(ConversationPreview, {
    props: {
      ...props,
      width: 320,
      height: 460,
      theme: 'dark',
      messages: [
        ...(props.messages ?? []),
        {
          id: 'canonical-model-notice',
          role: 'system',
          timestamp: '2026-10-22T00:00:30Z',
          metadata: {
            type: 'model_changed',
            from: 'before-model',
            to: 'after-model',
            fromProvider: 'codex',
            toProvider: 'codex',
          },
          contentBlocks: [{ type: 'text', text: 'Model changed.' }],
        },
        {
          id: 'canonical-effort-notice',
          role: 'system',
          timestamp: '2026-10-22T00:00:31Z',
          metadata: { type: 'effort_changed', from: 'low', to: 'high' },
          contentBlocks: [{ type: 'text', text: 'Effort changed.' }],
        },
        {
          id: 'canonical-provider-notice',
          role: 'system',
          timestamp: '2026-10-22T00:00:32Z',
          metadata: {
            type: 'provider_rehomed',
            reason: 'provider_disabled',
            from: 'old-model',
            to: 'new-model',
            fromProvider: 'codex',
            toProvider: 'claude-code',
          },
          contentBlocks: [{ type: 'text', text: 'Provider changed.' }],
        },
        {
          id: 'canonical-image',
          role: 'user',
          timestamp: '2026-10-22T00:01:00Z',
          contentBlocks: [{ type: 'image', data: clipboardPng, mimeType: 'image/png' }],
        },
      ],
    },
  });
  const wake = component.getByTestId('automated-wake-header');
  await wake.scrollIntoViewIfNeeded();
  await expect(wake).toHaveAttribute('data-wake-kind', 'script');
  await expect(wake).toContainText('Review navigation');
  const toggle = wake.getByTestId('automated-wake-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('automated-wake-details')).toHaveCount(0);
  await toggle.click();
  await expect(component.getByTestId('automated-wake-details')).toContainText('DockRail.svelte');
  await toggle.click();
  await expect(component.getByTestId('automated-wake-details')).toHaveCount(0);

  const eventSummary = component.getByTestId('event-wakeup-summary');
  await eventSummary.scrollIntoViewIfNeeded();
  await expect(eventSummary).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('event-wakeup-details')).toHaveCount(0);
  await eventSummary.click();
  await expect(eventSummary).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('event-wakeup-detail')).toHaveCount(1);
  await eventSummary.click();
  await expect(component.getByTestId('event-wakeup-details')).toHaveCount(0);

  const answer = component.locator('[data-message-id="structured-response"]');
  await answer.scrollIntoViewIfNeeded();
  await expect(answer.locator('strong')).toHaveText('workspace and focus');
  await expect(answer.locator('[data-tool-primary]').first()).toBeVisible();
  const modelNotice = component.locator('[data-message-id="canonical-model-notice"]');
  await modelNotice.scrollIntoViewIfNeeded();
  await expect(modelNotice).toContainText('before-model');
  await expect(modelNotice).toContainText('after-model');
  await expect(component.locator('[data-message-id="canonical-effort-notice"]')).toContainText(
    /Low.*High/,
  );
  await expect(component.locator('[data-message-id="canonical-provider-notice"]')).toContainText(
    'old-model',
  );
  await component.screenshot({ path: testInfo.outputPath('conversation-shared-notices.png') });
  const image = component.locator('[data-message-id="canonical-image"] img');
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute('src', `data:image/png;base64,${clipboardPng}`);

  const queue = component.getByTestId('queued-messages-container');
  await queue.scrollIntoViewIfNeeded();
  await expect(queue.getByTestId('queued-message-row')).toHaveCount(1);
  await expect(queue.getByTestId('queued-message-text')).toHaveText(
    'Keep the keyboard behavior consistent with the main conversation.',
  );
  await expect(queue.getByTestId('queued-message-actions')).toHaveCount(0);
  await expect(component.getByText('Reply queued', { exact: true })).toHaveCount(0);
  await queue.getByTestId('queued-messages-disclosure').click();
  await expect(queue.getByTestId('queued-messages-content')).toHaveCount(0);
  await queue.getByTestId('queued-messages-disclosure').click();
  await expect(queue.getByTestId('queued-message-row')).toHaveCount(1);
  const geometry = await component.evaluate((root) => {
    const header = root.querySelector('[data-slot="screen-header"]');
    const composer = root.querySelector('textarea');
    if (!header || !composer) throw new Error('Conversation controls missing');
    return {
      width: root.clientWidth,
      scrollWidth: root.scrollWidth,
      root: root.getBoundingClientRect().toJSON(),
      header: header.getBoundingClientRect().toJSON(),
      composer: composer.getBoundingClientRect().toJSON(),
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.header.left).toBeGreaterThanOrEqual(geometry.root.left);
  expect(geometry.header.right).toBeLessThanOrEqual(geometry.root.right);
  expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.root.bottom);
  await component.screenshot({ path: testInfo.outputPath('conversation-canonical-narrow.png') });
  await writeFile(
    testInfo.outputPath('conversation-canonical-geometry.json'),
    JSON.stringify(geometry, null, 2),
  );
  await component.unmount();
});

test('conversation reader stays put while new activity arrives at narrow width', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 640 });
  const component = await mount(ConversationPreview, {
    props: { ...dockConversationPreview.states.narrow.props, theme: 'dark' },
  });
  const scroll = component.locator('.transcript-scroll');
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(25);
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('dock-conversation-preview-message', {
        detail: {
          id: 'live-new',
          role: 'assistant',
          timestamp: '2026-10-22T00:01:00Z',
          contentBlocks: [{ type: 'text', text: 'A new response arrived while you were reading.' }],
        },
      }),
    ),
  );
  await expect(component.getByTestId('chat-floating-scroll-to-bottom-button')).toBeVisible();
  await expect.poll(async () => scroll.evaluate((el) => el.scrollTop)).toBe(0);
  await component.getByTestId('chat-floating-scroll-to-bottom-button').click();
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(25);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('dock-conversation-preview-message', {
        detail: {
          id: 'live-new',
          role: 'assistant',
          timestamp: '2026-10-22T00:01:00Z',
          contentBlocks: [
            {
              type: 'text',
              text: 'A new response arrived while you were reading.\n\nNow the same message has continued streaming with additional detail.',
            },
          ],
        },
      }),
    ),
  );
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(25);
  await expect(component.getByTestId('chat-floating-scroll-to-bottom-button')).toHaveCount(0);
  const geometry = await component.evaluate((root) => {
    const composer = root.querySelector('textarea');
    if (!composer) throw new Error('Composer missing');
    return {
      width: root.clientWidth,
      scrollWidth: root.scrollWidth,
      root: root.getBoundingClientRect().toJSON(),
      composer: composer.getBoundingClientRect().toJSON(),
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.root.bottom);
  await expect(component.getByRole('region', { name: 'Messages', exact: true })).toHaveCount(1);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.focus();
  await expect(composer).toBeFocused();
  await component.screenshot({ path: testInfo.outputPath('conversation-reader-narrow.png') });
  await writeFile(
    testInfo.outputPath('conversation-reader.json'),
    JSON.stringify({ scope: 'Presentation fake stream only', geometry }, null, 2),
  );
});
