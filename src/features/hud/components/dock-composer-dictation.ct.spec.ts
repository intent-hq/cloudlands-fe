import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';

/**
 * Dictation in the real dock conversation (production controller, sagas and
 * editor; only the daemon wire and the native helper are scripted):
 * Send while the microphone is live sends exactly once with every word, the
 * caret stays at the end of the dictated words, and the placeholder never sits
 * under live words.
 */
test.use({ viewport: { width: 452, height: 680 } });

type Harness = {
  native: {
    say: (text: string) => void;
    holdSpeechStops: (value: boolean) => void;
    log: { speech: { started: string[]; stopped: string[] } };
  };
  calls: { method: string; params: Record<string, unknown> }[];
};

const harness = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E;
    return {
      sends: h.calls
        .filter(
          (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
        )
        .map((call) => String(call.params.content ?? '')),
      started: h.native.log.speech.started.length,
    };
  });

const say = (page: Page, text: string) =>
  page.evaluate(
    (value) =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.say(value),
    text,
  );

const holdStops = (page: Page, value: boolean) =>
  page.evaluate(
    (hold) =>
      (
        window as unknown as { __dockComposerE2E: Harness }
      ).__dockComposerE2E.native.holdSpeechStops(hold),
    value,
  );

async function mountDock(mount: (component: typeof ComposerE2EHarness) => Promise<Locator>) {
  const component = await mount(ComposerE2EHarness);
  const editor = component.locator('[data-testid="message-input"] [contenteditable="true"]');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return { component, editor, submit: component.getByTestId('composer-submit-button') };
}

/** Text of the field on each side of the caret (live words are inside the field). */
const aroundCaret = (editor: Locator) =>
  editor.evaluate((root) => {
    const selection = window.getSelection()!;
    const caret = selection.getRangeAt(0);
    const before = document.createRange();
    before.setStart(root, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    const after = document.createRange();
    after.setStart(caret.endContainer, caret.endOffset);
    after.setEnd(root, root.childNodes.length);
    return {
      before: before.toString(),
      after: after.toString(),
      live: root.querySelector('[data-screen-interim]')?.textContent ?? null,
    };
  });

/** The editor's own caret position (its state, which trails DOM selection changes). */
const editorSelection = (editor: Locator) =>
  editor.evaluate(
    (el) =>
      (el as unknown as { editor?: { state: { selection: { from: number } } } }).editor?.state
        .selection.from,
  );

/** The placeholder pseudo-element's text for the empty first paragraph, if any. */
const placeholderText = (editor: Locator) =>
  editor.evaluate((root) => {
    const empty = root.querySelector('p.is-editor-empty');
    if (!empty) return '';
    const content = getComputedStyle(empty, '::before').content;
    return content === 'none' ? '' : content.replace(/^"|"$/g, '');
  });

test('Send while dictating stops the microphone and sends every word exactly once', async ({
  mount,
  page,
}) => {
  const { component, editor, submit } = await mountDock(mount);
  await component.getByRole('button', { name: /^Dictate/ }).click();
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await say(page, 'Fix the header spacing');
  await expect(editor.locator('[data-screen-interim]')).toContainText('Fix the header spacing');
  // Only live words exist: Send must still accept the first click.
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(async () => (await harness(page)).sends).toEqual(['Fix the header spacing']);
  await page.waitForTimeout(300);
  expect((await harness(page)).sends).toHaveLength(1);
  // The box is empty after the send and nothing refills it.
  await expect(editor).toHaveText('');
  await expect(component.getByText('Listening', { exact: true })).toHaveCount(0);
});

test('Send keeps live words as typed text when the final transcript is late, without a second send', async ({
  mount,
  page,
}) => {
  const { component, editor, submit } = await mountDock(mount);
  await editor.click();
  await page.keyboard.type('Note: ');
  await component.getByRole('button', { name: /^Dictate/ }).click();
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await say(page, 'the live words');
  await expect(editor.locator('[data-screen-interim]')).toContainText('the live words');
  await holdStops(page, true);
  await editor.focus();
  await page.keyboard.press('Enter');
  // While Send waits for the final words it shows a busy state and ignores more clicks.
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await harness(page)).sends, { timeout: 6_000 })
    .toEqual(['Note: the live words']);
  // The late final arrives after the send: it adds nothing and sends nothing.
  await holdStops(page, false);
  await page.waitForTimeout(400);
  expect((await harness(page)).sends).toHaveLength(1);
  await expect(editor).not.toContainText('the live words');
});

test('the caret follows dictated words from where the user placed it', async ({ mount, page }) => {
  const { component, editor } = await mountDock(mount);
  await editor.click();
  await page.keyboard.type('Start end');
  // The user places the caret before "end" (set directly: synthetic arrow keys race
  // the editor's asynchronous DOM-selection read under parallel load).
  await editor.evaluate((el) =>
    (
      el as unknown as { editor?: { commands: { setTextSelection: (at: number) => void } } }
    ).editor?.commands.setTextSelection(7),
  );
  // The editor has really taken the caret move before dictation starts (it reads the
  // DOM selection asynchronously, so poll its own state, not the DOM).
  await expect.poll(() => editorSelection(editor)).toBe(7);
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await expect(editor).toBeFocused();
  await say(page, 'middle');
  await expect(editor.locator('[data-screen-interim]')).toContainText('middle');
  // Live words sit at the caret position, and the caret is after them.
  let around = await aroundCaret(editor);
  expect(around.live).not.toBeNull();
  expect(around.before.endsWith(around.live!)).toBe(true);
  expect(around.after).toBe('end');
  await say(page, ' and more');
  await expect(editor.locator('[data-screen-interim]')).toContainText('middle and more');
  await expect.poll(async () => (await aroundCaret(editor)).after).toBe('end');
  around = await aroundCaret(editor);
  expect(around.before.endsWith(around.live!)).toBe(true);
  expect(around.live).toContain('middle and more');
  // Finalizing commits the words in place; the caret stays at their end.
  await page.keyboard.press('ControlOrMeta+Shift+M');
  await expect(editor.locator('[data-screen-interim]')).toHaveCount(0);
  await expect(editor).toContainText('middle and more');
  around = await aroundCaret(editor);
  expect(around.before.trimEnd().endsWith('middle and more')).toBe(true);
  expect(around.before.startsWith('Start')).toBe(true);
  expect(around.after.trimStart()).toBe('end');
});

test('the placeholder is hidden while dictation is live and under live words', async ({
  mount,
  page,
}) => {
  const { component, editor } = await mountDock(mount);
  await expect.poll(() => placeholderText(editor)).not.toBe('');
  await component.getByRole('button', { name: /^Dictate/ }).click();
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await expect.poll(() => placeholderText(editor)).toBe('');
  await say(page, 'Hello there');
  await expect(editor.locator('[data-screen-interim]')).toContainText('Hello there');
  expect(await placeholderText(editor)).toBe('');
});
