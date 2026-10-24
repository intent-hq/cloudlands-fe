import { expect, test } from '../../../../test/ct-test';
import ChatActivityTypographyPreview from '../chat-activity-typography.preview.svelte';

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
