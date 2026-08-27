import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import ChatPanelComposerGeometryHost from '../__tests__/ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

const states = [
  { name: 'tall wide light at 100%', height: 800, width: 720, zoom: 1, theme: 'light' },
  { name: 'tall narrow dark at 200%', height: 800, width: 180, zoom: 2, theme: 'dark' },
  { name: 'compact wide dark at 200%', height: 560, width: 720, zoom: 2, theme: 'dark' },
  { name: 'compact narrow light at 100%', height: 560, width: 180, zoom: 1, theme: 'light' },
] as const;

async function setPanelHeight(component: Locator, height: number) {
  await component.locator('div.h-160').evaluate((node, value) => {
    (node as HTMLElement).style.height = `${value}px`;
  }, height);
}

async function composerHeight(input: Locator, zoom: number) {
  return input.evaluate((node, scale) => node.getBoundingClientRect().height / scale, zoom);
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

async function expectImmediatePlaceholderOpacity(editor: Locator, opacity: number) {
  const motion = await placeholderMotion(editor);
  expect(motion.opacity).toBe(opacity);
  expect(Number.parseFloat(motion.duration)).toBeLessThanOrEqual(0.00001);
}

for (const state of states) {
  test(`reveals the placeholder without focus growth and animates content geometry in ${state.name}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(ChatPanelComposerGeometryHost, { props: state });
    await setPanelHeight(component, state.height);
    const input = component.getByTestId('message-input');
    const editor = input.locator('.tiptap-editor');
    const editorWrapper = input.locator('.editor-wrapper');
    const actionBar = input.locator('[data-chat-input-action-bar]');
    const compact = state.height <= 640;
    const idle = compact ? 56 : 80;
    const active = compact ? 65 : 100;

    await editor.blur();
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${idle}px`);
    await expect(editorWrapper).toHaveClass(/placeholder-hidden/);
    await expect(editor.locator('p')).toHaveAttribute('data-placeholder', 'Ask anything');
    expect(await placeholderMotion(editor)).toEqual({
      opacity: 0,
      property: 'opacity',
      duration: '0.3s',
      easing: 'ease-in-out',
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
    expect(motion.duration).toBe('0.1s');
    expect(motion.easing).toBe('cubic-bezier(0.2, 0, 0, 1)');

    const idleRendered = await composerHeight(input, state.zoom);
    await editor.focus();
    await expect(editorWrapper).not.toHaveClass(/placeholder-hidden/);
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${idle}px`);
    await page.waitForTimeout(150);
    const fadingIn = (await placeholderMotion(editor)).opacity;
    expect(fadingIn).toBeGreaterThan(0);
    expect(fadingIn).toBeLessThan(0.85);
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBeCloseTo(0.85, 2);
    expect(await composerHeight(input, state.zoom)).toBeCloseTo(idleRendered, 0);
    await page.keyboard.type('draft');
    const expanding = await composerHeight(input, state.zoom);
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${active}px`);
    await page.waitForTimeout(150);
    const activeRendered = await composerHeight(input, state.zoom);
    expect(expanding).toBeGreaterThanOrEqual(Math.min(idleRendered, activeRendered));
    expect(expanding).toBeLessThanOrEqual(Math.max(idleRendered, activeRendered));

    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    const collapsing = await composerHeight(input, state.zoom);
    expect(collapsing).toBeGreaterThanOrEqual(Math.min(idleRendered, activeRendered));
    expect(collapsing).toBeLessThanOrEqual(Math.max(idleRendered, activeRendered));
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${idle}px`);
    await page.waitForTimeout(150);
    expect(await composerHeight(input, state.zoom)).toBeCloseTo(idleRendered, 0);
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBeCloseTo(0.85, 2);

    await editor.blur();
    await expect(editorWrapper).toHaveClass(/placeholder-hidden/);
    await page.waitForTimeout(150);
    const fadingOut = (await placeholderMotion(editor)).opacity;
    expect(fadingOut).toBeGreaterThan(0);
    expect(fadingOut).toBeLessThan(0.85);
    await expect.poll(async () => (await placeholderMotion(editor)).opacity).toBe(0);

    await editor.focus();
    await page.waitForTimeout(20);
    await editor.blur();
    await page.waitForTimeout(20);
    await editor.focus();
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${idle}px`);
    await page.waitForTimeout(150);
    expect(await composerHeight(input, state.zoom)).toBeCloseTo(idleRendered, 0);

    const containment = await input.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const editorBox = node.querySelector('.editor-wrapper')!.getBoundingClientRect();
      const actionBox = node.querySelector('[data-chat-input-action-bar]')!.getBoundingClientRect();
      return {
        editorTop: editorBox.top - box.top,
        actionBottom: box.bottom - actionBox.bottom,
        overflow: node.scrollHeight - node.clientHeight,
      };
    });
    expect(containment.editorTop).toBeGreaterThanOrEqual(0);
    expect(containment.actionBottom).toBeGreaterThanOrEqual(-0.5);
    expect(containment.overflow).toBeLessThanOrEqual(1);
    await expect(actionBar).toBeVisible();
  });
}

test('changes content height immediately with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { width: 720, zoom: 1, theme: 'dark' },
  });
  await setPanelHeight(component, 800);
  const input = component.getByTestId('message-input');
  const editor = input.locator('.tiptap-editor');
  const editorWrapper = input.locator('.editor-wrapper');
  await editor.blur();
  await expect.poll(() => input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('80px');

  expect(await input.evaluate((node) => getComputedStyle(node).transitionProperty)).toBe('none');
  await expectImmediatePlaceholderOpacity(editor, 0);
  await editor.focus();
  await expect(editorWrapper).not.toHaveClass(/placeholder-hidden/);
  await expectImmediatePlaceholderOpacity(editor, 0.85);
  expect(await input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('80px');
  await page.keyboard.type('draft');
  expect(await input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('100px');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  expect(await input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('80px');
  await editor.blur();
  await expect(editorWrapper).toHaveClass(/placeholder-hidden/);
  await expectImmediatePlaceholderOpacity(editor, 0);
  expect(await input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('80px');
});

test('does not animate manual resize height changes on focus', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { width: 420, zoom: 1, theme: 'light' },
  });
  await setPanelHeight(component, 800);
  const input = component.getByTestId('message-input');
  const editor = input.locator('.tiptap-editor');
  const resize = input.locator('.resize-handle');
  const handle = (await resize.boundingBox())!;
  const handleY = handle.y + handle.height / 2;
  await resize.dispatchEvent('mousedown', { clientY: handleY });
  await page.evaluate((clientY) => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY }));
  }, handleY - 60);

  await expect
    .poll(() => input.evaluate((node) => getComputedStyle(node).transitionProperty))
    .not.toContain('min-height');
  const resized = await composerHeight(input, 1);
  await editor.focus();
  expect(await composerHeight(input, 1)).toBeCloseTo(resized, 0);
  await editor.blur();
  expect(await composerHeight(input, 1)).toBeCloseTo(resized, 0);
});
