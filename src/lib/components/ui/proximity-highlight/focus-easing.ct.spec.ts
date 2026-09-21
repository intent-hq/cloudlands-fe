import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import AskUserQuestions from '../ask-user-questions/ask-user-questions.svelte';
import MenuTestHarness from '../menu/MenuTestHarness.svelte';

type Rect = { x: number; y: number; width: number; height: number };
type Input = 'keyboard' | 'pointer';

const questionProps = {
  questions: [
    {
      id: 'priority',
      title: 'Choose a priority',
      options: [
        { id: 'speed', title: 'Speed' },
        {
          id: 'quality',
          title: 'Quality',
          description: 'Review the implementation carefully before delivering the final result.',
        },
        { id: 'scope', title: 'Scope' },
      ],
    },
  ],
};

async function rect(locator: Locator): Promise<Rect> {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}

function expectAligned(actual: Rect, target: Rect) {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - target[key]), `${key} aligns with the actual row`).toBeLessThan(
      0.5,
    );
  }
}

async function expectInstantAlignment(page: Page, highlight: Locator, row: Locator) {
  const target = await rect(row);
  const frozenTime = await page.evaluate(() => performance.now());
  // Svelte may flush DOM effects after the input protocol call resolves. Retry
  // that render only: the paused clock cannot advance a non-reduced tween.
  await expect(async () => expectAligned(await rect(highlight), target)).toPass({ timeout: 1000 });
  expect(await page.evaluate(() => performance.now())).toBe(frozenTime);
}

function expectBounded(samples: Rect[], from: Rect, to: Rect) {
  let previous = from;
  for (const sample of samples) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(sample[key], `${key} never overshoots`).toBeGreaterThanOrEqual(
        Math.min(from[key], to[key]) - 0.5,
      );
      expect(sample[key], `${key} never overshoots`).toBeLessThanOrEqual(
        Math.max(from[key], to[key]) + 0.5,
      );
      expect(
        Math.abs(to[key] - sample[key]),
        `${key} approaches its new target`,
      ).toBeLessThanOrEqual(Math.abs(to[key] - previous[key]) + 0.5);
    }
    previous = sample;
  }
}

async function sampleFrames(page: Page, highlight: Locator, count: number) {
  const samples: Rect[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    await page.clock.runFor(16);
    samples.push(await rect(highlight));
  }
  return samples;
}

async function pointAt(page: Page, row: Locator) {
  const box = await rect(row);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

for (const surface of ['menu', 'questions'] as const) {
  test.describe(`${surface} focus background easing`, () => {
    test.beforeEach(async ({ mount, page }) => {
      await page.clock.install();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      if (surface === 'menu') {
        await mount(MenuTestHarness);
        await page.getByRole('button', { name: 'Actions', exact: true }).click();
        await expect(page.getByRole('menu')).toBeVisible();
      } else {
        await mount(AskUserQuestions, { props: questionProps });
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        // Finish only opening CSS/WAAPI animations; the production highlight's
        // requestAnimationFrame-driven motion remains under the controlled clock.
        for (const animation of document.getAnimations()) animation.finish();
      });
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
      await page.clock.runFor(32);
    });

    function rows(page: Page) {
      return surface === 'menu'
        ? ['Apple', 'Banana', 'Cherry'].map((name) =>
            page.getByRole('menuitem', { name, exact: true }),
          )
        : [0, 1, 2].map((index) => page.getByRole('radio').nth(index));
    }

    async function move(page: Page, input: Input, row: Locator, key: string) {
      if (input === 'pointer') await pointAt(page, row);
      else {
        await page.keyboard.press(key);
        await expect(row).toBeFocused();
      }
    }

    for (const input of ['keyboard', 'pointer'] as const) {
      test(`${input} moves between rows and reverses without overshoot`, async ({
        page,
      }, testInfo) => {
        const [first, second, third] = rows(page);
        const highlight = page.locator('[data-proximity-highlight="hover"]');
        if (input === 'keyboard') await first.focus();
        else await pointAt(page, first);
        await page.clock.runFor(240);
        const start = await rect(first);
        const destination = await rect(second);
        expectAligned(await rect(highlight), start);

        await move(page, input, second, 'ArrowDown');
        const forward = await sampleFrames(page, highlight, 12);
        expectBounded(forward, start, destination);
        // At 80ms this short 160ms movement must be visibly in flight, not a
        // teleport or the old imperceptibly fast hover tier. No wall-clock sleeps.
        expect(forward[4].y).toBeGreaterThan(start.y + 1);
        expect(forward[4].y).toBeLessThan(destination.y - 1);
        expectAligned(forward.at(-1)!, destination);

        await move(page, input, third, 'ArrowDown');
        const outward = await sampleFrames(page, highlight, 4);
        const thirdRect = await rect(third);
        expectBounded(outward, destination, thirdRect);
        const interrupted = outward.at(-1)!;
        expect(interrupted.y).toBeGreaterThan(destination.y + 1);
        expect(interrupted.y).toBeLessThan(thirdRect.y - 1);

        if (input === 'keyboard') {
          const surfaceRoot = page.locator(
            surface === 'menu' ? '[data-slot="menu-content"]' : '[data-slot="ask-user-questions"]',
          );
          await testInfo.attach(`${surface}-mid-flight`, {
            body: await page.screenshot({ clip: await rect(surfaceRoot) }),
            contentType: 'image/png',
          });
        }

        await move(page, input, first, 'Home');
        // Pointer proximity is resolved on the next animation frame. Begin the
        // reversal oracle once that event has been consumed, not before it.
        if (input === 'pointer') await page.clock.runFor(16);
        const reversalStart = await rect(highlight);
        const reversed = await sampleFrames(page, highlight, 12);
        expectBounded(reversed, reversalStart, start);
        expect(reversed[3].y).toBeLessThan(reversalStart.y - 1);
        expectAligned(reversed.at(-1)!, start);
        await testInfo.attach('focus-background-geometry', {
          body: Buffer.from(
            JSON.stringify(
              { start, destination, forward, thirdRect, outward, reversalStart, reversed },
              null,
              2,
            ),
          ),
          contentType: 'application/json',
        });
      });
    }

    test('reduced motion settles immediately for keyboard and pointer navigation', async ({
      page,
    }) => {
      const [first, second, third] = rows(page);
      const highlight = page.locator('[data-proximity-highlight="hover"]');
      await first.focus();
      await page.clock.runFor(240);
      await page.emulateMedia({ reducedMotion: 'reduce' });

      await page.keyboard.press('ArrowDown');
      await expect(second).toBeFocused();
      await expectInstantAlignment(page, highlight, second);

      await pointAt(page, second);
      await page.clock.runFor(32);
      await pointAt(page, third);
      // Allow the proximity frame and its render flush, not the 160ms easing.
      await page.clock.runFor(32);
      const destination = await rect(third);
      await expectInstantAlignment(page, highlight, third);
      for (const sample of await sampleFrames(page, highlight, 12)) {
        expectAligned(sample, destination);
      }
    });
  });
}
