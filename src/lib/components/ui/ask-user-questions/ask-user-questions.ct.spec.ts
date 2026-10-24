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

// An unbreakable token (no spaces or hyphens) must still wrap: the card clips
// overflow, so any text laid out past its edge is cut off and unreadable. The
// inline and stacked option layouts lay out option text differently.
for (const layout of ['inline', 'stacked'] as const) {
  test(`long unbreakable tokens wrap inside a narrow card (${layout} options)`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 340, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const token = 'background_start_stop_exits_cleanly_after_owned_daemon_pid_file_read';
    const component = await mount(AskUserQuestions, {
      props: {
        size: 'compact',
        questions: [
          {
            id: 'flake',
            header: `Flake ${token}`,
            title: `The stress loop hit ${token} once. Fix it in this PR too?`,
            description: `Also covers ${token}.`,
            layout,
            options: [
              { id: 'include', title: `Include ${token}`, description: `Same fix for ${token}.` },
              { id: 'separate', title: 'Separate follow-up' },
            ],
          },
        ],
      },
    });
    const card = page.locator('[data-slot="ask-user-questions"]');
    await expect(card).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Measure the rendered glyph boxes of every text run, not element boxes:
    // text can overflow an element whose own box still fits inside the card.
    const clipped = await card.evaluate((node) => {
      const cardBox = node.getBoundingClientRect();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const runs: { text: string; left: number; right: number }[] = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent?.trim()) continue;
        range.selectNodeContents(text);
        for (const rect of range.getClientRects()) {
          if (rect.width === 0) continue;
          runs.push({
            text: text.textContent.trim().slice(0, 40),
            left: cardBox.left - rect.left,
            right: rect.right - cardBox.right,
          });
        }
      }
      return { count: runs.length, outside: runs.filter((r) => r.left > 1 || r.right > 1) };
    });
    expect(clipped.count).toBeGreaterThan(0);
    expect(clipped.outside).toEqual([]);
    const option = component.getByRole('radio').first();
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
  });
}
