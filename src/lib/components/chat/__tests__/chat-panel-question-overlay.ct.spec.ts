import { expect, test } from '@playwright/experimental-ct-svelte';
import { isolateBrowserContextPerTest } from '../../../../test/ct-isolated-browser-context';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import type { Locator } from '@playwright/test';

test.setTimeout(120_000);
isolateBrowserContextPerTest(test, 'intent-hq/intent#4783');

async function toggleWithMotion(button: Locator, reduced: boolean) {
  const motion = await button.evaluate(async (node: HTMLButtonElement) => {
    const root = node.closest('[data-question-wizard]')!;
    node.click();
    await new Promise(requestAnimationFrame);
    const states = Array.from(root.querySelectorAll<HTMLElement>('[data-question-state]'));
    const frames = states.map((state) => ({
      state: state.dataset.questionState,
      exiting: state.inert,
      animations: state.getAnimations().filter(
        (animation) =>
          // Svelte retains a 0.01ms bookkeeping animation for zero-duration transitions.
          animation.playState === 'running' && Number(animation.effect?.getTiming().duration) > 1,
      ).length,
    }));
    root.getAnimations({ subtree: true }).forEach((animation) => animation.finish());
    return frames;
  });
  if (reduced) expect(motion.every((state) => state.animations === 0)).toBe(true);
  else {
    expect(motion.filter((state) => state.animations > 0)).toHaveLength(2);
    expect(motion.filter((state) => state.exiting)).toHaveLength(1);
  }
}

async function toggleBeforeSettling(button: Locator) {
  await button.evaluate(async (node: HTMLButtonElement) => {
    const root = node.closest('[data-question-wizard]')!;
    node.click();
    await new Promise(requestAnimationFrame);
    // Hold both branches so the next click must reuse an unfinished outgoing surface.
    root.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
  });
}

for (const { width, height, reducedMotion } of [
  { width: 720, height: 640, reducedMotion: 'reduce' as const },
  { width: 280, height: 320, reducedMotion: 'reduce' as const },
  { width: 720, height: 640, reducedMotion: 'no-preference' as const },
]) {
  test(`centers the question over an inert composer inside ${width}x${height} with ${reducedMotion} motion`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: { width, height, questions: true },
    });
    const card = component.getByTestId('question-wizard-card');
    const composer = component.getByTestId('question-composer-input');
    const editor = component.getByTestId('message-input').locator('.tiptap-editor');
    await expect(card).toBeVisible();
    await expect(composer).toHaveAttribute('inert', '');
    await expect(editor).toBeVisible();
    await expect
      .poll(() =>
        card.evaluate(
          (node) =>
            node
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length,
        ),
      )
      .toBe(0);
    const geometry = await card.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const parent = node.closest('[data-testid="question-composer"]')!;
      const lane = parent.getBoundingClientRect();
      const panel = node.closest('.chat-panel-container')!.getBoundingClientRect();
      const behind = parent.querySelector('[data-testid="question-composer-input"]')!;
      const input = behind.getBoundingClientRect();
      return {
        width: box.width,
        center: box.x + box.width / 2,
        laneCenter: lane.x + lane.width / 2,
        top: box.top,
        bottom: box.bottom,
        panelTop: panel.top,
        panelBottom: panel.bottom,
        overlap: Math.min(box.bottom, input.bottom) - Math.max(box.top, input.top),
        filter: getComputedStyle(behind).filter,
        outerBorder: getComputedStyle(node.closest('[data-question-wizard]')!).borderTopWidth,
        cardBorder: getComputedStyle(node).borderTopWidth,
        overflow: node.scrollWidth - node.clientWidth,
      };
    });
    expect(geometry.width).toBeLessThanOrEqual(640);
    if (width === 720) expect(geometry.width).toBeGreaterThan(480);
    expect(geometry.center).toBeCloseTo(geometry.laneCenter, 0);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.panelTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.panelBottom);
    expect(geometry.overlap).toBeGreaterThan(0);
    expect(geometry.filter).toMatch(/blur\([1-9]/);
    expect(geometry.outerBorder).toBe('0px');
    expect(geometry.cardBorder).toBe('1px');
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await editor.evaluate((node: HTMLElement) => node.focus());
    await expect(editor).not.toBeFocused();
    await component.getByRole('checkbox').first().focus();
    await page.keyboard.press('Space');
    await expect(component.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
    await toggleWithMotion(
      component.getByRole('button', { name: 'Hide', exact: true }),
      reducedMotion === 'reduce',
    );
    await expect(card).toHaveCount(0);
    await expect(composer).not.toHaveAttribute('inert', '');
    await expect(editor).toBeFocused();
    const collapsed = component.locator('[data-question-wizard]');
    const [collapsedBox, composerBox] = await Promise.all([
      collapsed.boundingBox(),
      composer.boundingBox(),
    ]);
    expect(collapsedBox!.width).toBeCloseTo(composerBox!.width, 0);
    await editor.pressSequentially('Draft survives expansion.');
    const expand = component.getByRole('button', { name: /Click to expand/i });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.hover();
    expect(
      await expand
        .locator('[data-slot="button-surface"]')
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
    await toggleWithMotion(expand, reducedMotion === 'reduce');
    await expect(component.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
    await expect(component.getByRole('checkbox').first()).toBeFocused();
    await expect(composer).toHaveAttribute('inert', '');
    await component.getByRole('button', { name: 'Skip', exact: true }).scrollIntoViewIfNeeded();
    await expect(component.getByRole('button', { name: 'Skip', exact: true })).toBeInViewport();
    const [cardBox, submitBox] = await Promise.all([
      card.boundingBox(),
      component.getByRole('button', { name: /Continue/ }).boundingBox(),
    ]);
    expect(submitBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(submitBox!.x + submitBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    await component.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(editor).toContainText('Draft survives expansion.');
    await expect(editor).toBeFocused();
    if (reducedMotion === 'no-preference') {
      const hide = component.getByRole('button', { name: 'Hide', exact: true });
      await toggleBeforeSettling(expand);
      await toggleBeforeSettling(hide);
      await toggleBeforeSettling(expand);
      const expandedState = component.locator('[data-question-state="expanded"]');
      await expect(expandedState).not.toHaveAttribute('inert', '');
      await expect(expandedState).not.toHaveAttribute('aria-hidden', 'true');
      expect(await expandedState.evaluate((node) => getComputedStyle(node).position)).toBe(
        'static',
      );
      await collapsed.evaluate((node) =>
        node.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
      );
      await expect(component.locator('[data-question-state]')).toHaveCount(1);
      await expect(component.getByRole('checkbox').first()).toBeFocused();
      await expect(component.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('2');
      await expect(component.getByRole('checkbox').nth(1)).toHaveAttribute('aria-checked', 'true');
      await hide.click();
      await expect(card).toHaveCount(0);
      await expect(editor).toBeFocused();
    }
    await component.update({ props: { width, height, questions: false } });
    await expect(collapsed).toHaveCount(0);
    await expect(editor).toContainText('Draft survives expansion.');
  });
}
