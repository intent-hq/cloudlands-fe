import { expect, test } from '../../../../test/ct-test';
import QuotaRecoveryHost from './QuotaRecoveryHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`warning cards read as title, subject and hint with one Retry per target (${theme})`, async ({
    mount,
  }) => {
    const component = await mount(QuotaRecoveryHost, { props: { theme } });

    const withAlternative = component.getByTestId('quota-with-alternative');
    await expect(withAlternative.getByText('Usage limit reached')).toBeVisible();
    await expect(
      withAlternative.getByText('Retry once it resets, or switch provider.'),
    ).toBeVisible();
    await expect(withAlternative.getByRole('button', { name: /retry/i })).toHaveText([
      'Retry on OpenAI Codex',
      'Retry',
    ]);

    const resetOnly = component.getByTestId('quota-reset-only');
    await expect(resetOnly.getByText('Retry once it resets.', { exact: true })).toBeVisible();
    await expect(resetOnly.getByRole('button', { name: /retry/i })).toHaveText(['Retry']);

    const modelUnavailable = component.getByTestId('model-unavailable');
    await expect(modelUnavailable.getByText('Model unavailable')).toBeVisible();
    await expect(modelUnavailable.getByTestId('model-unavailable-label')).toHaveText(
      'claude-opus-5-5',
    );
    await expect(modelUnavailable.getByRole('button', { name: /retry/i })).toHaveText([
      'Retry with claude-sonnet-5',
    ]);

    for (const card of [withAlternative, resetOnly, modelUnavailable]) {
      // The subject is plain text, not a code chip, and wraps inside the card.
      await expect(card.locator('code')).toHaveCount(0);
      const fits = await card.getByTestId('failure-recovery-card').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')].every(
          (child) => child.getBoundingClientRect().right <= box.right + 0.5,
        );
      });
      expect(fits).toBe(true);
    }
  });
}
