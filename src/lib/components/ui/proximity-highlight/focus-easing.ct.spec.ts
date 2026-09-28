import { expect, test } from '../../../../test/ct-test';
import AskUserQuestions from '../ask-user-questions/ask-user-questions.svelte';
import MenuTestHarness from '../menu/MenuTestHarness.svelte';
import SidebarHarness from '../sidebar/SidebarHarness.svelte';
import TabsHarness from '../tabs/TabsHarness.svelte';
import ToggleGroupHarness from '../toggle-group/toggle-group.test-harness.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;
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

async function sampleFrames(page: Page, highlight: Locator, count: number, companion?: Locator) {
  const samples: Rect[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    await page.clock.runFor(16);
    const sample = await rect(highlight);
    samples.push(sample);
    if (companion) expectAligned(await rect(companion), sample);
  }
  return samples;
}

async function pointAt(page: Page, row: Locator) {
  const box = await rect(row);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function freezeMotion(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Finish opening CSS/WAAPI animations, not the RAF-driven highlight motion.
    for (const animation of document.getAnimations()) animation.finish();
  });
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await page.clock.runFor(32);
}

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((error) => error.stack ?? error.message)).toEqual([]);
});

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
      await freezeMotion(page);
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

test.describe('related indicator easing', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('sidebar hover and keyboard focus reverse smoothly without moving the active row', async ({
    mount,
    page,
  }) => {
    await mount(SidebarHarness, { props: { open: true } });
    await freezeMotion(page);
    const first = page.getByRole('button', { name: 'Overview', exact: true });
    const second = page.getByRole('button', { name: 'Projects navigation' });
    const third = page.getByRole('button', { name: 'Settings navigation' });
    const hover = page.locator('[data-sidebar="menu-hover-highlight"]');
    const focus = page.locator('[data-sidebar="menu-focus-highlight"]');
    const active = page.locator('[data-sidebar="menu-active-highlight"]');
    await first.focus();
    await page.clock.runFor(240);
    const start = await rect(first);
    const destination = await rect(second);
    expectAligned(await rect(hover), start);
    expectAligned(await rect(focus), start);

    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
    const forward = await sampleFrames(page, hover, 4, focus);
    expectBounded(forward, start, destination);
    const interrupted = forward.at(-1)!;
    expect(interrupted.y).toBeGreaterThan(start.y + 1);
    expect(interrupted.y).toBeLessThan(destination.y - 1);
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    const reversed = await sampleFrames(page, hover, 12, focus);
    expectBounded(reversed, interrupted, start);
    expectAligned(reversed.at(-1)!, start);

    await pointAt(page, third);
    const outward = await sampleFrames(page, hover, 4);
    expectBounded(outward, start, await rect(third));
    expect(outward.at(-1)!.y).toBeGreaterThan(destination.y + 1);
    await pointAt(page, second);
    await page.clock.runFor(16);
    const pointerStart = await rect(hover);
    const pointerReverse = await sampleFrames(page, hover, 12);
    expectBounded(pointerReverse, pointerStart, destination);
    expectAligned(pointerReverse.at(-1)!, destination);
    expectAligned(await rect(active), start);
    await expect(first).toHaveAttribute('aria-current', 'page');
    await expect(second).not.toHaveAttribute('aria-current');
  });

  test('sidebar preserves highlight lifecycle across density changes and reduced navigation', async ({
    mount,
    page,
  }) => {
    const component = await mount(SidebarHarness, { props: { open: true } });
    await freezeMotion(page);
    const first = page.getByRole('button', { name: 'Overview', exact: true });
    const second = page.getByRole('button', { name: 'Projects navigation' });
    const third = page.getByRole('button', { name: 'Settings navigation' });
    const hover = page.locator('[data-sidebar="menu-hover-highlight"]');
    const focus = page.locator('[data-sidebar="menu-focus-highlight"]');
    await first.focus();
    await page.clock.runFor(240);
    await page.keyboard.press('Shift+Tab');
    await expect(first).not.toBeFocused();
    await page.clock.runFor(240);
    await expect(hover).toHaveCount(0);
    await expect(focus).toHaveCount(0);
    await first.focus();
    await expect(first).toBeFocused();
    await page.clock.runFor(240);
    expectAligned(await rect(hover), await rect(first));
    expectAligned(await rect(focus), await rect(first));
    await component.update({ props: { open: true, fixtureState: 'compact' } });
    await page.clock.runFor(32);
    expect((await page.pageErrors()).map((error) => error.stack ?? error.message)).toEqual([]);
    // Changing the public Menu size inserts a SizeProvider and remounts the rows.
    // Refocus the new control rather than assuming DOM identity survives that change.
    await first.focus();
    await expect(first).toBeFocused();
    await page.clock.runFor(240);
    expectAligned(await rect(hover), await rect(first));
    expectAligned(await rect(focus), await rect(first));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
    await expectInstantAlignment(page, hover, second);
    await expectInstantAlignment(page, focus, second);
    await pointAt(page, third);
    await page.clock.runFor(32);
    await expectInstantAlignment(page, hover, third);
    expectAligned(
      await rect(page.locator('[data-sidebar="menu-active-highlight"]')),
      await rect(first),
    );
  });

  test('default tabs retarget horizontal selection and honor reduced motion', async ({
    mount,
    page,
  }) => {
    await mount(TabsHarness);
    await freezeMotion(page);
    const first = page.getByRole('tab', { name: 'Overview' });
    const second = page.getByRole('tab', { name: 'Activity' });
    const indicator = page.locator('[data-tabs-indicator]');
    await first.focus();
    await page.clock.runFor(240);
    const start = await rect(first);
    const destination = await rect(second);
    expectAligned(await rect(indicator), start);
    await page.keyboard.press('ArrowRight');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    const forward = await sampleFrames(page, indicator, 4);
    expectBounded(forward, start, destination);
    const interrupted = forward.at(-1)!;
    expect(interrupted.x).toBeGreaterThan(start.x + 1);
    expect(interrupted.x).toBeLessThan(destination.x - 1);
    await page.keyboard.press('ArrowLeft');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    const reverse = await sampleFrames(page, indicator, 12);
    expectBounded(reverse, interrupted, start);
    expectAligned(reverse.at(-1)!, start);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowRight');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expectInstantAlignment(page, indicator, second);
    await page.keyboard.press('ArrowRight');
    await expect(first).toBeFocused();
    await expectInstantAlignment(page, indicator, first);
  });

  test('horizontal proximity and merged selection stay bounded through growth and reversal', async ({
    mount,
    page,
  }) => {
    await mount(ToggleGroupHarness, { props: { multiple: true } });
    await freezeMotion(page);
    const first = page.getByRole('button', { name: 'List view' });
    const second = page.getByRole('button', { name: 'Tree view' });
    const hover = page.locator('[data-proximity-highlight="hover"]');
    const selected = page.locator('[data-proximity-highlight="selected"]');
    await first.focus();
    await page.clock.runFor(240);
    const start = await rect(first);
    const destination = await rect(second);
    expectAligned(await rect(selected), start);
    await page.keyboard.press('ArrowRight');
    await expect(second).toBeFocused();
    const forward = await sampleFrames(page, hover, 12);
    expectBounded(forward, start, destination);
    expect(forward[4].x).toBeGreaterThan(start.x + 1);
    expect(forward[4].x).toBeLessThan(destination.x - 1);
    expectAligned(forward.at(-1)!, destination);

    const merged = { ...start, width: destination.x + destination.width - start.x };
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveCount(1);
    const growth = await sampleFrames(page, selected, 4);
    expectBounded(growth, start, merged);
    const interrupted = growth.at(-1)!;
    expect(interrupted.width).toBeGreaterThan(start.width + 1);
    expect(interrupted.width).toBeLessThan(merged.width - 1);
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    const reverse = await sampleFrames(page, selected, 12);
    expectBounded(reverse, interrupted, start);
    expectAligned(reverse.at(-1)!, start);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    const frozenTime = await page.evaluate(() => performance.now());
    await expect(async () => expectAligned(await rect(selected), merged)).toPass({ timeout: 1000 });
    expect(await page.evaluate(() => performance.now())).toBe(frozenTime);
    await page.mouse.move(1000, 700);
    await page.clock.runFor(240);
    expectAligned(await rect(selected), merged);
    await expect(first).toHaveAttribute('aria-pressed', 'true');
  });
});
