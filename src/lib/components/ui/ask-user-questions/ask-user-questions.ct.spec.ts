import { expect, test } from '@playwright/experimental-ct-svelte';
import AskUserQuestions from './ask-user-questions.svelte';

for (const theme of ['light', 'dark']) {
  test(`free-text focus preserves the card fill in ${theme}`, async ({ mount, page }) => {
    await page.evaluate((value) => {
      document.documentElement.className = value;
    }, theme);
    const component = await mount(AskUserQuestions, {
      props: {
        questions: [{ id: 'name', title: 'Project name', freeText: true }],
      },
    });
    const input = component.getByRole('textbox');
    await input.hover();
    await input.focus();
    await expect(input).toBeFocused();
    await expect
      .poll(() => input.evaluate((node) => getComputedStyle(node).backgroundColor))
      .toBe('rgba(0, 0, 0, 0)');
    await expect
      .poll(() =>
        input.evaluate((node) => {
          const wrapper = node.parentElement!;
          const card = node.closest('[data-slot="ask-user-questions"]')!;
          return (
            getComputedStyle(wrapper).backgroundColor === getComputedStyle(card).backgroundColor
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `.dev/show/ux2-question-focused-${theme}.png` });
  });
}

for (const size of ['default', 'compact'] as const) {
  test(`option hover keeps its text inset and card gutter at ${size} density`, async ({
    mount,
    page,
  }) => {
    const component = await mount(AskUserQuestions, {
      props: {
        size,
        questions: [
          {
            id: 'priority',
            title: 'Choose a priority',
            options: [
              { id: 'speed', title: 'Speed' },
              { id: 'quality', title: 'Quality' },
            ],
          },
        ],
      },
    });
    const row = component.getByRole('radio').first();
    await row.hover();
    const geometry = await row.evaluate((node) => {
      const row = node.getBoundingClientRect();
      const card = node.closest('[data-slot="ask-user-questions"]')!.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        left: row.left - card.left,
        right: card.right - row.right,
        paddingLeft: parseFloat(style.paddingLeft),
        paddingRight: parseFloat(style.paddingRight),
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(8);
    expect(geometry.right).toBeGreaterThanOrEqual(8);
    expect(geometry.paddingLeft).toBeGreaterThanOrEqual(10);
    expect(geometry.paddingRight).toBeGreaterThanOrEqual(10);
    await page.screenshot({ path: `.dev/show/ux2-question-hover-${size}.png` });
  });
}
