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

for (const state of states) {
  test(`animates automatic focus geometry without clipping in ${state.name}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(ChatPanelComposerGeometryHost, { props: state });
    await setPanelHeight(component, state.height);
    const input = component.getByTestId('message-input');
    const editor = input.locator('.tiptap-editor');
    const actionBar = input.locator('[data-chat-input-action-bar]');
    const compact = state.height <= 640;
    const idle = compact ? 56 : 80;
    const active = compact ? 65 : 100;

    await editor.blur();
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${idle}px`);
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
    await page.keyboard.press('Enter');
    const expanding = await composerHeight(input, state.zoom);
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${active}px`);
    await page.waitForTimeout(150);
    const activeRendered = await composerHeight(input, state.zoom);
    expect(expanding).toBeGreaterThanOrEqual(Math.min(idleRendered, activeRendered));
    expect(expanding).toBeLessThanOrEqual(Math.max(idleRendered, activeRendered));

    await editor.blur();
    const collapsing = await composerHeight(input, state.zoom);
    expect(collapsing).toBeGreaterThanOrEqual(Math.min(idleRendered, activeRendered));
    expect(collapsing).toBeLessThanOrEqual(Math.max(idleRendered, activeRendered));
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${idle}px`);
    await page.waitForTimeout(150);
    expect(await composerHeight(input, state.zoom)).toBeCloseTo(idleRendered, 0);

    await editor.focus();
    await page.waitForTimeout(20);
    await editor.blur();
    await page.waitForTimeout(20);
    await editor.focus();
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).minHeight))
      .toBe(`${active}px`);
    await page.waitForTimeout(150);
    expect(await composerHeight(input, state.zoom)).toBeCloseTo(activeRendered, 0);

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

test('changes focus height immediately with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { width: 720, zoom: 1, theme: 'dark' },
  });
  await setPanelHeight(component, 800);
  const input = component.getByTestId('message-input');
  const editor = input.locator('.tiptap-editor');
  await editor.blur();
  await expect.poll(() => input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('80px');

  expect(await input.evaluate((node) => getComputedStyle(node).transitionProperty)).toBe('none');
  await editor.focus();
  expect(await input.evaluate((node) => getComputedStyle(node).minHeight)).toBe('100px');
  await editor.blur();
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
