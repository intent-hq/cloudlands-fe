import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/local-editor?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('choice-editor-demo');
  const editor = demo.getByRole('textbox', { name: 'Choice node-view editor', exact: true });
  const block = editor.locator('[data-type="choice-block"]');
  const question = block.locator('[data-type="choice-question"] p');
  await expect(question).toHaveText('Which project should we open?');
  await block.scrollIntoViewIfNeeded();
  return {
    demo,
    editor,
    block,
    question,
    errors,
    snapshot: async () => JSON.parse(await demo.locator('output').textContent()),
  };
}

test('choice question preserves its content node and focus during native editing', async ({
  page,
}, info) => {
  const { demo, editor, block, question, errors, snapshot } = await openDemo(page);
  const oldQuestion = await question.elementHandle();
  const before = await block.boundingBox();
  await question.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Updated ');
  await expect(question).toHaveText('Updated Which project should we open?');
  await expect(editor).toBeFocused();
  expect(await oldQuestion.evaluate((node) => node.isConnected)).toBe(true);
  expect((await snapshot()).document.content[1].content[0].content[0].content[0].text).toBe(
    'Updated Which project should we open?',
  );
  await demo.getByRole('button', { name: 'Read-only editor', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await question.click();
  await page.keyboard.type('Rejected edit');
  await expect(question).toHaveText('Updated Which project should we open?');
  await demo.getByRole('button', { name: 'Read-only editor', exact: true }).click();
  await question.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Again ');
  await expect(question).toHaveText('Again Updated Which project should we open?');
  await expect(editor).toBeFocused();
  await page.mouse.move(0, 0);
  const frame = page.getByTestId('choice-editor-frame');
  await frame.scrollIntoViewIfNeeded();
  const after = await block.boundingBox();
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.x + after.width).toBeLessThanOrEqual(420);
  await info.attach('choice-editor-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
    if (png) await info.attach(`choice-editor-${attempt}`, { body: png, contentType: 'image/png' });
  });
  expect(errors).toEqual([]);
});

for (const activation of ['click', 'Enter', 'Space']) {
  test(`choice block ${activation} deletes one editor node and undo restores it`, async ({
    page,
  }) => {
    const { demo, editor, block, errors, snapshot } = await openDemo(page);
    const original = await block.elementHandle();
    await page.mouse.move(0, 0);
    await expect(block.getByRole('button')).toHaveCount(0);
    await block.hover();
    const remove = block.getByRole('button', { name: 'Delete choice block', exact: true });
    await expect(remove).toBeVisible();
    if (activation === 'click') await remove.click();
    else {
      await remove.focus();
      await page.keyboard.press(activation);
    }
    await expect(block).toHaveCount(0);
    expect(await original.evaluate((node) => node.isConnected)).toBe(false);
    expect(await snapshot()).toEqual({
      changes: 1,
      document: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Before the choice' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'After the choice' }] },
        ],
      },
    });
    await demo.getByRole('button', { name: 'Undo choice change', exact: true }).click();
    await expect(block).toHaveCount(1);
    expect((await snapshot()).changes).toBe(2);
    await expect(editor).toContainText('Which project should we open?');
    expect(errors).toEqual([]);
  });
}

test('choice editor unmount retires content and remount is independently editable', async ({
  page,
}) => {
  const { demo, editor, question, errors, snapshot } = await openDemo(page);
  const oldEditor = await editor.elementHandle();
  const oldQuestion = await question.elementHandle();
  await demo.getByRole('button', { name: 'Mount choice editor', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await oldEditor.evaluate((node) => node.isConnected)).toBe(false);
  expect(await oldQuestion.evaluate((node) => node.isConnected)).toBe(false);
  await demo.getByRole('button', { name: 'Mount choice editor', exact: true }).click();
  await expect(question).toHaveText('Which project should we open?');
  expect((await snapshot()).changes).toBe(0);
  await question.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Fresh ');
  await expect(question).toHaveText('Fresh Which project should we open?');
  await expect(editor).toBeFocused();
  expect(errors).toEqual([]);
});
