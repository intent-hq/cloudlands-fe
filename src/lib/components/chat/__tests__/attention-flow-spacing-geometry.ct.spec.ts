import { expect, test } from '@playwright/experimental-ct-svelte';
import AttentionFlowSpacingGeometryHost from './AttentionFlowSpacingGeometryHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 960]) {
    for (const zoom of [1, 2]) {
      test(`balances attention flow in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
      }) => {
        const component = await mount(AttentionFlowSpacingGeometryHost, {
          props: { theme, width, zoom, scenario: 'attention-answer' },
        });
        const measure = () =>
          component.evaluate((root) => {
            const rect = (testId: string) =>
              root.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect();
            return {
              attentionToFinished:
                rect('finished-operational-row').top - rect('attention-card').bottom,
              finishedToAnswer: rect('question-answer-card').top - rect('seam-finished-row').bottom,
              attentionAnswerSeam: root
                .querySelector('[data-testid="conversation-turn-gap"]')!
                .getAttribute('data-attention-answer-seam'),
              batchSeam: root
                .querySelector('[data-testid="conversation-turn-gap"]')!
                .getAttribute('data-batched-seam'),
              batchedWakeSeam:
                root
                  .querySelector(
                    '[data-testid="batched-wake-lane"] [data-testid="event-wakeup-card"]',
                  )!
                  .getBoundingClientRect().top - rect('batched-wake-predecessor').bottom,
            };
          });

        expect(await measure()).toEqual({
          attentionToFinished: 16 * zoom,
          finishedToAnswer: 24 * zoom,
          attentionAnswerSeam: 'true',
          batchSeam: null,
          batchedWakeSeam: 8 * zoom,
        });

        for (const scenario of ['ordinary-batch', 'malformed-answer'] as const) {
          await component.update({ props: { theme, width, zoom, scenario } });
          const negative = await measure();
          expect(negative.finishedToAnswer, scenario).toBeCloseTo(8 * zoom, 1);
          expect(negative.attentionAnswerSeam, scenario).toBeNull();
          expect(negative.batchSeam, scenario).toBe('true');
          expect(negative.attentionToFinished, scenario).toBeCloseTo(
            (scenario === 'ordinary-batch' ? 32 : 16) * zoom,
            1,
          );
        }
      });
    }
  }
}
