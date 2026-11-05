import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

for (const { width, height, reducedMotion, theme = 'light' } of [
  { width: 720, height: 640, reducedMotion: 'reduce' as const },
  { width: 280, height: 320, reducedMotion: 'reduce' as const, theme: 'dark' as const },
  { width: 720, height: 640, reducedMotion: 'no-preference' as const },
  { width: 720, height: 640, reducedMotion: 'reduce' as const, theme: 'dark' as const },
]) {
  test(`centers a single-boundary question and keeps collapsed actions inline inside ${width}x${height} in ${theme} with ${reducedMotion} motion`, async ({
    mount,
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion });
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: { width, height, theme, questions: true },
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
      const probe = document.createElement('span');
      probe.style.borderColor = 'hsl(var(--border))';
      node.append(probe);
      const neutralBorder = getComputedStyle(probe).borderTopColor;
      probe.remove();
      const paint = [
        node,
        node.parentElement!,
        node.closest('[data-question-wizard]')!,
        node.closest('[data-testid="question-wizard-slot"]')!,
        parent,
      ].map((element) => {
        const style = getComputedStyle(element);
        return {
          borders: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          color: style.borderTopColor,
          shadow: style.boxShadow,
          outline: style.outlineStyle,
        };
      });

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
        neutralBorder,
        paint,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.panelTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.panelBottom);
    expect(geometry.overlap).toBeGreaterThan(0);
    expect(geometry.filter).toMatch(/blur\([1-9]/);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.paint[0].color).toBe(geometry.neutralBorder);
    for (const paint of geometry.paint) {
      expect(paint.shadow).toBe('none');
      expect(paint.outline).toBe('none');
    }
    await editor.evaluate((node: HTMLElement) => node.focus());
    await expect(editor).not.toBeFocused();
    await component.getByRole('checkbox').first().focus();
    await page.keyboard.press('Space');
    await expect(component.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('question-expanded.png'),
    });
    await component.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(composer).not.toHaveAttribute('inert', '');
    await expect(editor).toBeFocused();
    const collapsed = component.locator('[data-question-wizard]');
    await editor.pressSequentially('Draft survives expansion.');
    const expand = component.getByRole('button', { name: /Click to expand/i });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    const dismiss = component.getByRole('button', { name: 'Dismiss', exact: true });
    const [barBox, expandBox, dismissBox, titleBox, hintBox, countBox] = await Promise.all(
      [
        component.locator('[data-question-state="collapsed"]'),
        expand,
        dismiss,
        expand.getByText(/^Agent has questions$/i),
        expand.getByText(/Click to expand/i),
        expand.getByText('1', { exact: true }),
      ].map((locator) => locator.boundingBox()),
    );
    for (const box of [dismissBox, titleBox, hintBox, countBox]) {
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.x).toBeGreaterThanOrEqual(barBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width);
    }
    expect(expandBox!.x + expandBox!.width).toBeLessThanOrEqual(dismissBox!.x);
    await page.screenshot({
      animations: 'disabled',
      path: info.outputPath('question-collapsed.png'),
    });
    await expand.focus();
    await page.keyboard.press('Tab');
    await expect(dismiss).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expand.click();
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
      await expand.click();
      const expandedState = component.locator('[data-question-state="expanded"]');
      await expect(expandedState).not.toHaveAttribute('inert', '');
      await expect(expandedState).not.toHaveAttribute('aria-hidden', 'true');
      expect(await expandedState.evaluate((node) => getComputedStyle(node).position)).toBe(
        'static',
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
