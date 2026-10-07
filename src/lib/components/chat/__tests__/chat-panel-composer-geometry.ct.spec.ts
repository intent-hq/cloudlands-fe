import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import {
  applyAuroraPaintProbe,
  colorDistance,
  isPaintProbe,
  samplePanelBottomPixels,
} from './aurora-panel-pixels';

test.setTimeout(120_000);

for (const chief of [false, true]) {
  test(`keeps ${chief ? 'Chief' : 'regular'} editing usable in a narrow panel at 200% zoom`, async ({
    mount,
  }) => {
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: {
        chief,
        width: 180,
        zoom: 2,
        streaming: true,
        draft: 'Long streaming draft '.repeat(12),
      },
    });
    const input = component.getByTestId('message-input');
    const editor = input.locator('.tiptap-editor');
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.pressSequentially('Continue reviewing.');
    await expect(editor).toContainText('Continue reviewing.');

    await expect
      .poll(() =>
        input.evaluate((node) => {
          const editor = node.querySelector('.editor-wrapper')!;
          const actionBar = node.querySelector('[data-chat-input-action-bar]')!;
          return (
            [node, editor, actionBar].every(
              (element) => element.scrollWidth - element.clientWidth <= 1,
            ) &&
            editor.getBoundingClientRect().bottom <= actionBar.getBoundingClientRect().top + 0.5
          );
        }),
      )
      .toBe(true);
  });
}

test('clips streaming glow under the dark scroll fade at 200% zoom and removes it when idle', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const props = { theme: 'dark' as const, zoom: 2, width: 180, streaming: false };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const aurora = component.getByTestId('composer-aurora-host');
  const panel = component.locator('.panel');

  await expect(aurora).toHaveCount(0);
  await component.update({ props: { ...props, streaming: true } });
  await expect(aurora).toBeVisible();
  await applyAuroraPaintProbe(aurora);
  const clipped = await samplePanelBottomPixels(panel);
  clipped.outsideCorners.forEach((corner) => expect(isPaintProbe(corner)).toBe(false));
  clipped.insideCorners.forEach((corner) => expect(isPaintProbe(corner)).toBe(true));

  // Break clipping to prove that the pixel probe detects escaped paint.
  await panel.evaluate((node) => {
    (node as HTMLElement).style.setProperty('--panel-shell-radius', '0px');
  });
  try {
    const leaking = await samplePanelBottomPixels(panel);
    leaking.outsideCorners.forEach((corner, index) => {
      expect(isPaintProbe(corner)).toBe(true);
      expect(colorDistance(corner, clipped.outsideCorners[index])).toBeGreaterThan(100);
    });
  } finally {
    await panel.evaluate((node) => {
      (node as HTMLElement).style.removeProperty('--panel-shell-radius');
    });
  }

  await component.update({ props });
  await expect(aurora).toHaveCount(0);
});

test('keeps suggestions accessible and inserts them after resizing into compact mode', async ({
  mount,
}) => {
  const props = { width: 720, height: 960, suggestions: true };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const suggestions = component.getByTestId('suggested-prompts-surface');
  const list = component.getByTestId('suggested-prompts-list');
  const input = component.getByTestId('message-input');
  const gap = async () => {
    const [promptsBox, inputBox] = await Promise.all([
      suggestions.boundingBox(),
      input.boundingBox(),
    ]);
    return inputBox!.y - promptsBox!.y - promptsBox!.height;
  };

  await expect(list).toHaveAttribute('data-compact', 'false');
  await expect.poll(gap).toBeGreaterThan(0);
  await component.update({ props: { ...props, height: 480 } });
  await expect(list).toHaveAttribute('data-compact', 'true');
  await expect.poll(gap).toBeGreaterThan(0);

  await suggestions.getByRole('button', { name: 'Edit in input' }).first().click();
  await expect(input.locator('.tiptap-editor')).toContainText('Review the layout.');
  await expect.poll(gap).toBeGreaterThan(0);
});

test('supports attachment keyboard navigation, removal, and composer resizing', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { draft: 'Resizable attachment draft', width: 420 },
  });
  const input = component.getByTestId('message-input');
  const editor = component.locator('.tiptap-editor');
  const resize = input.locator('.resize-handle');
  await component.locator('input[type="file"]').setInputFiles({
    name: 'composer.png',
    mimeType: 'image/png',
    buffer: Buffer.from('composer-image'),
  });
  const attachment = component.getByRole('img', { name: 'composer.png' });
  await expect(attachment).toBeVisible();

  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(
    component.getByRole('button', { name: 'View composer.png full size' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Remove composer.png' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(component.getByRole('button', { name: 'Default model' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(attachment).toHaveCount(0);

  const before = (await input.boundingBox())!.height;
  const handle = (await resize.boundingBox())!;
  const handleY = handle.y + handle.height / 2;
  await resize.dispatchEvent('mousedown', { clientY: handleY });
  await page.evaluate((clientY) => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY }));
  }, handleY - 60);
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(before);
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`shows a submitted prompt before preparation with keyboard focus and follow-scroll preserved (${reducedMotion})`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const props = {
      width: 520,
      height: 480,
      submissionSupport: true,
      followUp: 'discussion' as const,
    };
    const component = await mount(ChatPanelComposerGeometryHost, { props });
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await editor.click();
    await editor.pressSequentially('Visible before preparation');
    await editor.press('Enter');
    const pending = component
      .locator('[data-send-app-message-id]')
      .filter({ hasText: 'Visible before preparation' });
    await expect(pending).toHaveCount(1);
    await expect(pending).toBeVisible();
    await expect(editor).toBeFocused();
    await expect(editor).not.toContainText('Visible before preparation');
    await expect
      .poll(async () =>
        pending.evaluate((node) => {
          const scroll =
            node.closest('[data-testid="chat-transcript-scroll-viewport"]') ??
            node.closest('.overflow-y-auto');
          if (!scroll) return false;
          const row = node.getBoundingClientRect();
          const viewport = scroll.getBoundingClientRect();
          return row.top >= viewport.top - 1 && row.bottom <= viewport.bottom + 1;
        }),
      )
      .toBe(true);
    await component.update({ props: { ...props, settleSubmission: 'history' } });
    await expect(component.getByText('Visible before preparation', { exact: true })).toHaveCount(1);
    await expect(editor).toBeFocused();
    await expect(page.locator('[data-message-send-transition]')).toHaveCount(0);
  });
}

test('keeps the first submission bottom-aligned when history confirms it', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const props = { width: 520, height: 960, submissionSupport: true };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  const text = 'Keep this first submission in place';
  await editor.fill(text);
  await editor.press('Enter');
  const pending = component.locator('[data-send-app-message-id]:not([data-message-index])');
  await expect(pending).toContainText(text);
  const prompt = component.getByText(text, { exact: true });
  const before = (await prompt.boundingBox())!;
  await page.screenshot({ path: testInfo.outputPath('first-submission-pending.png') });

  await component.update({ props: { ...props, settleSubmission: 'history' } });
  await expect(pending).toHaveCount(0);
  await expect(prompt).toHaveCount(1);
  const after = (await prompt.boundingBox())!;
  await page.screenshot({ path: testInfo.outputPath('first-submission-confirmed.png') });
  await testInfo.attach('first-submission-position', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  const utility = (await component.getByTestId('transcript-utility-stack').boundingBox())!;
  expect(utility.y - before.y - before.height).toBeGreaterThanOrEqual(0);
  expect(utility.y - before.y - before.height).toBeLessThan(64);
  await expect(editor).toBeFocused();
});

test('moves the same visible submission into a queue fallback while preserving a new draft', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const props = { width: 520, height: 480, submissionSupport: true };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.click();
  await editor.pressSequentially('Queue this after admission');
  await editor.press('Enter');
  await expect(component.getByText('Queue this after admission', { exact: true })).toHaveCount(1);
  await editor.pressSequentially('Keep this newer draft');
  await component.update({ props: { ...props, settleSubmission: 'queue' } });
  await expect(
    component
      .getByTestId('queued-messages-container')
      .getByText('Queue this after admission', { exact: true }),
  ).toBeVisible();
  await expect(component.getByText('Queue this after admission', { exact: true })).toHaveCount(1);
  await expect(editor).toContainText('Keep this newer draft');
  await expect(editor).toBeFocused();
});

test('retries a rejected submission before preparation while preserving the newer draft', async ({
  mount,
}) => {
  const props = {
    width: 520,
    height: 480,
    submissionSupport: true,
    followUp: 'discussion' as const,
  };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await editor.click();
  await editor.pressSequentially('Retry the earlier submission');
  await editor.press('Enter');
  await expect(component.getByText('Retry the earlier submission', { exact: true })).toHaveCount(1);
  await editor.pressSequentially('Keep the newer draft');
  await component.update({ props: { ...props, settleSubmission: 'rejected' } });
  await expect(component.getByText('Retry the earlier submission', { exact: true })).toHaveCount(0);
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(component.getByText('Retry the earlier submission', { exact: true })).toHaveCount(1);
  await expect(editor).toContainText('Keep the newer draft');
});

test('shows and splits a queued append while preserving keyboard focus and deferring mutation controls', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const props = {
    width: 520,
    height: 560,
    streaming: true,
    submissionSupport: true,
    queuePhase: 'ready' as const,
  };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const queue = component.getByTestId('queued-messages-container');
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await expect(queue.getByTestId('queued-message-text')).toHaveText('Confirmed A');
  await editor.click();
  await editor.pressSequentially('Pending B');
  await editor.press('Enter');
  await expect(queue.getByTestId('queued-message-text')).toHaveText('Confirmed A\n\nPending B');
  await expect(queue.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await expect(queue.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await expect(queue.getByRole('button', { name: 'Send immediately', exact: true })).toBeDisabled();
  await expect(queue.getByRole('button', { name: 'Send all ready messages now' })).toBeDisabled();
  await expect(queue.getByRole('button', { name: 'Clear all queued messages' })).toBeDisabled();
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Keep newer draft');
  await expect
    .poll(async () => {
      const pending = await queue.getByTestId('queued-message-row').boundingBox();
      const viewport = await queue.getByTestId('queued-messages-viewport').boundingBox();
      return (
        !!pending &&
        !!viewport &&
        pending.y >= viewport.y - 1 &&
        pending.y + pending.height <= viewport.y + viewport.height + 1
      );
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('queue-pending.png') });
  await component.update({ props: { ...props, queuePhase: 'foreign' } });
  await expect(queue.getByTestId('queued-message-text')).toHaveText([
    'Confirmed A',
    'Other participant',
    'Pending B',
  ]);
  await expect(
    queue
      .getByTestId('queued-message-row')
      .nth(1)
      .getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
  await expect(editor).toContainText('Keep newer draft');
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => {
      const pending = await queue.getByTestId('queued-message-row').nth(2).boundingBox();
      const viewport = await queue.getByTestId('queued-messages-viewport').boundingBox();
      return (
        !!pending &&
        !!viewport &&
        pending.y >= viewport.y - 1 &&
        pending.y + pending.height <= viewport.y + viewport.height + 1
      );
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('queue-foreign.png') });
});

test('shows authoritative restored queue work alongside its already persisted history', async ({
  mount,
}) => {
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { submissionSupport: true, queuePhase: 'restored' },
  });
  await expect(component.getByTestId('queued-message-text')).toHaveText('Confirmed A');
  await expect(component.getByText('Persisted A', { exact: true })).toBeVisible();
  await expect(component.getByTestId('queued-message-retry-status')).toBeVisible();
});
