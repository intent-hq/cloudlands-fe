import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatActivityTypographyPreview from '../chat-activity-typography.preview.svelte';

for (const monospace of [false, true]) {
  test(`activity summaries share reading typography with ${monospace ? 'monospace' : 'system'} preference`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatActivityTypographyPreview, { props: { monospace } });
    await page.evaluate(() => document.fonts.ready);
    const typography = await component.evaluate((root) => {
      const selectors = [
        '[data-testid=agent-message-actor-name]',
        '[data-testid=agent-message-status]',
        '[data-activity-type="agent:idle"] [data-testid=event-wakeup-status]',
        '[data-activity-type="agent:reportToParent"] [data-testid=event-wakeup-status]',
        '[data-activity-type="agent:attention-requested"] [data-slot=button-label] span',
      ];
      return selectors.map((selector) => {
        const style = getComputedStyle(root.querySelector(selector)!);
        return {
          fontSize: parseFloat(style.fontSize),
          lineHeight: parseFloat(style.lineHeight),
          fontWeight: style.fontWeight,
          fontFamily: style.fontFamily,
        };
      });
    });
    for (const actual of typography) {
      expect(actual).toMatchObject({ fontSize: 15, lineHeight: 22, fontWeight: '400' });
      expect(actual.fontFamily.includes('monospace')).toBe(monospace);
      expect(actual).toEqual(typography[2]);
    }

    const toggle = component.getByTestId('agent-message-disclosure-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const body = component.getByTestId('agent-message-expanded-body');
    await expect(body).toBeVisible();
    await expect(body).toContainText('Review the activity rows and keep the message readable.');
    const bodyTypography = await body.locator('[data-expanded=true]').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
      };
    });
    expect(bodyTypography).toEqual({ fontSize: '15px', lineHeight: '22px', fontWeight: '500' });
    await page.keyboard.press('Space');
    await expect(body).toBeHidden();
    await expect(toggle).toBeFocused();

    const finished = component.locator('[data-activity-type="agent:idle"]');
    await finished.getByTestId('event-wakeup-summary').click();
    await expect(finished.getByTestId('event-wakeup-details')).toBeVisible();
    const timestamp = await finished.getByTestId('event-wakeup-timestamp').evaluate((node) => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    expect(timestamp).toEqual({ fontSize: '13px', lineHeight: '18px' });
  });
}

test('long sender names wrap within narrow summaries and message text is expanded-only', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const agentName = 'Onboarding provider cards and workspace configuration';
  const component = await mount(ChatActivityTypographyPreview, { props: { agentName } });
  await page.evaluate(() => document.fonts.ready);
  const name = component.getByTestId('agent-message-actor-name');
  await expect(name).toHaveText(agentName);
  const geometry = await name.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const row = node.closest('[data-testid=agent-message-disclosure-header]')!;
    const parent = row.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    return {
      wrapped: bounds.height > parseFloat(getComputedStyle(node).lineHeight),
      contained: [...range.getClientRects()].every(
        (rect) =>
          rect.left >= parent.left &&
          rect.right <= parent.right &&
          rect.top >= parent.top &&
          rect.bottom <= parent.bottom,
      ),
      overflowing: row.scrollWidth > row.clientWidth,
    };
  });
  expect(geometry).toEqual({ wrapped: true, contained: true, overflowing: false });
  const bodyText = 'Review the activity rows and keep the message readable.';
  await expect(component.getByText(bodyText)).toBeHidden();
  const toggle = component.getByTestId('agent-message-disclosure-toggle');
  await expect(toggle).not.toHaveAccessibleName(new RegExp(bodyText));
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('agent-message-expanded-body')).toContainText(bodyText);
  await page.keyboard.press('Space');
  await expect(component.getByText(bodyText)).toBeHidden();
  await expect(toggle).toBeFocused();
});
