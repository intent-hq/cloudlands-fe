import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from '../__tests__/ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

const states = [
  { name: 'tall wide light at 100%', height: 800, width: 720, zoom: 1, theme: 'light' },
  { name: 'tall narrow dark at 200%', height: 800, width: 180, zoom: 2, theme: 'dark' },
  { name: 'compact wide dark at 200%', height: 560, width: 720, zoom: 2, theme: 'dark' },
  { name: 'compact narrow light at 100%', height: 560, width: 180, zoom: 1, theme: 'light' },
] as const;

async function expectComposerMotionSettled(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
}

async function placeholderMotion(editor: Locator) {
  return editor.locator('p').evaluate((node) => {
    const style = getComputedStyle(node, '::before');
    return {
      opacity: Number(style.opacity),
      property: style.transitionProperty,
      duration: style.transitionDuration,
      easing: style.transitionTimingFunction,
    };
  });
}

// Resolve token units and CSS easing serialization through the browser, just as
// a consumer does; the motion tokens now carry CSS time units.
async function motionTier(input: Locator, tier: 'slow' | 'fast') {
  return input.evaluate((node, name) => {
    const probe = document.createElement('span');
    probe.style.transitionDuration = name === 'slow' ? 'var(--spring-slow)' : 'var(--spring-fast)';
    probe.style.transitionTimingFunction =
      name === 'slow' ? 'var(--spring-slow-ease)' : 'var(--spring-fast-ease)';
    node.append(probe);
    const style = getComputedStyle(probe);
    const result = { duration: style.transitionDuration, easing: style.transitionTimingFunction };
    probe.remove();
    return result;
  }, tier);
}

async function expectImmediatePlaceholderOpacity(editor: Locator, opacity: number) {
  const motion = await placeholderMotion(editor);
  expect(motion.opacity).toBe(opacity);
  expect(Number.parseFloat(motion.duration)).toBeLessThanOrEqual(0.00001);
}

for (const state of states) {
  test(`reveals the placeholder on focus and restores it after clearing content in ${state.name}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(ChatPanelComposerGeometryHost, { props: state });
    const input = component.getByTestId('message-input');
    const editor = input.locator('.tiptap-editor');
    const editorWrapper = input.locator('.editor-wrapper');
    const actionBar = input.locator('[data-chat-input-action-bar]');
    await editor.blur();
    await expectComposerMotionSettled(input);
    await expect(editorWrapper).toHaveClass(/placeholder-hidden/);
    await expect(editor.locator('p')).toHaveAttribute('data-placeholder', 'Ask anything');
    /* The placeholder fades out over the slow motion tier after blur; on fast runners the
       assertions above settle sooner than that, so sampling opacity without
       waiting reads a mid-transition value. Poll to the terminal value first. */
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBe(0);
    const slowTier = await motionTier(input, 'slow');
    expect(await placeholderMotion(editor)).toEqual({
      opacity: 0,
      property: 'opacity',
      ...slowTier,
    });
    const motion = await input.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        property: style.transitionProperty,
        duration: style.transitionDuration,
        easing: style.transitionTimingFunction,
      };
    });
    expect(motion.property).toContain('min-height');
    const fastTier = await motionTier(input, 'fast');
    expect(motion.duration).toBe(fastTier.duration);
    expect(motion.easing).toBe(fastTier.easing);

    await editor.focus();
    await expect(editorWrapper).not.toHaveClass(/placeholder-hidden/);
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBeCloseTo(0.85, 2);
    await page.keyboard.type('draft');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await expectComposerMotionSettled(input);
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBeCloseTo(0.85, 2);

    await editor.blur();
    await expect(editorWrapper).toHaveClass(/placeholder-hidden/);
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBe(0);

    await expect(actionBar).toBeVisible();
  });
}

test('reveals and hides the placeholder immediately with reduced motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { width: 720, zoom: 1, theme: 'dark', height: 800 },
  });
  const input = component.getByTestId('message-input');
  const editor = input.locator('.tiptap-editor');
  const editorWrapper = input.locator('.editor-wrapper');
  await editor.blur();

  expect(await input.evaluate((node) => getComputedStyle(node).transitionProperty)).toBe('none');
  await expectImmediatePlaceholderOpacity(editor, 0);
  await editor.focus();
  await expect(editorWrapper).not.toHaveClass(/placeholder-hidden/);
  await expectImmediatePlaceholderOpacity(editor, 0.85);
  await page.keyboard.type('draft');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await editor.blur();
  await expect(editorWrapper).toHaveClass(/placeholder-hidden/);
  await expectImmediatePlaceholderOpacity(editor, 0);
});
