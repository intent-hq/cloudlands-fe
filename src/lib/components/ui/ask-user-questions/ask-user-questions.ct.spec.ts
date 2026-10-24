import { expect, test } from '../../../../test/ct-test';
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
  });
}

for (const size of ['default', 'compact'] as const) {
  test(`option hover stays inside the card at ${size} density`, async ({ mount }) => {
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
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeGreaterThanOrEqual(0);
  });
}

// An unbreakable token (no spaces or hyphens) must not widen the step past the
// card: the card clips overflow, so every line of the question would be cut off.
test('long unbreakable tokens wrap inside a narrow card', async ({ mount, page }) => {
  await page.setViewportSize({ width: 340, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const token = 'background_start_stop_exits_cleanly_after_owned_daemon_pid_file_read';
  const component = await mount(AskUserQuestions, {
    props: {
      size: 'compact',
      questions: [
        {
          id: 'flake',
          title: `The stress loop hit ${token} once. Fix it in this PR too?`,
          description: `Also covers ${token}.`,
          options: [
            { id: 'include', title: 'Include it', description: `Same fix for ${token}.` },
            { id: 'separate', title: 'Separate follow-up' },
          ],
        },
      ],
    },
  });
  const card = page.locator('[data-slot="ask-user-questions"]');
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const overflow = await card.evaluate((node) => {
    const cardBox = node.getBoundingClientRect();
    const texts = [...node.querySelectorAll('h3, p, [role="radio"]')].map((element) => {
      const box = element.getBoundingClientRect();
      return { text: element.textContent?.trim().slice(0, 40), right: box.right - cardBox.right };
    });
    return { scroll: node.scrollWidth - node.clientWidth, cardRight: cardBox.right, texts };
  });
  expect(overflow.cardRight).toBeLessThanOrEqual(340);
  expect(overflow.scroll).toBeLessThanOrEqual(1);
  for (const text of overflow.texts) expect.soft(text.right, text.text).toBeLessThanOrEqual(1);
  await component.getByRole('radio').first().click();
  await expect(component.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
});
