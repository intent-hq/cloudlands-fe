import { expect, test } from '../../../../test/ct-test';
import ThinkingSpacingGeometryHost from './ThinkingSpacingGeometryHost.svelte';
import {
  followingTitle,
  growingHistory,
  growthBody,
  growthTitles,
  thinking,
  titleToolHistory,
} from './compact-reasoning-fixtures';
import {
  assertContentOnceInOrder,
  captureReasoning,
  openReasoning,
  recordReasoningGeometry,
  settleReasoning,
  thinkingBoundaryGap,
} from './compact-reasoning-geometry';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      if (
        (theme === 'light' && (width !== 720 || zoom !== 1)) ||
        (theme === 'dark' && (width !== 320 || zoom !== 2))
      )
        continue;
      test(`keeps Thinking boundaries exact in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
        page,
      }) => {
        const component = await mount(ThinkingSpacingGeometryHost, {
          props: { theme, width, zoom, showStreamingThinking: true },
        });

        for (const [testId, previousSelector, expectedGap] of [
          ['attention-card-boundary', '[data-testid="attention-card"]', 20],
          // The borderless notice no longer adds the old card's 8px bottom margin.
          ['notice-boundary', '.discussion-request-notice', 16],
          ['prose-boundary', '[data-message-content-block="text"]', 16],
          ['message-content-boundary', '[data-testid="message-content"]', 20],
          ['streaming-boundary', '[data-message-content-block="text"]', 16],
        ] as const) {
          const fixture = component.getByTestId(testId);
          const measurement = await fixture.evaluate((root, selector) => {
            const rect = (element: Element) => {
              const box = element.getBoundingClientRect();
              return { top: box.top, bottom: box.bottom, height: box.height };
            };
            const thinking = root.querySelector('[data-testid="reasoning-tool-call"]')!;
            const row = thinking.querySelector('[data-operational-disclosure-row]')!;
            const previous = root.querySelector(selector);
            if (!previous) throw new Error(`Missing predecessor: ${selector}`);
            return { previous: rect(previous), thinking: rect(thinking), row: rect(row) };
          }, previousSelector);
          expect(measurement.thinking.top - measurement.previous.bottom, testId).toBeCloseTo(
            expectedGap * zoom,
            1,
          );
          expect(measurement.row.height, testId).toBeCloseTo(28 * zoom, 1);
        }

        const first = component.getByTestId('first-child-boundary');
        const firstGeometry = await first.evaluate((root) => {
          const stack = root.firstElementChild!;
          const wrapper = stack.querySelector('[data-message-content-block="thinking"]')!;
          const rootBox = stack.getBoundingClientRect();
          const thinkingBox = wrapper
            .querySelector('[data-testid="reasoning-tool-call"]')!
            .getBoundingClientRect();
          return {
            rootTop: rootBox.top,
            thinkingTop: thinkingBox.top,
          };
        });
        expect(firstGeometry.thinkingTop - firstGeometry.rootTop).toBeCloseTo(0, 1);

        const operationalGeometry = await component
          .getByTestId('operational-boundary')
          .evaluate((root) => {
            const tool = root.querySelector('[data-message-content-block="tool_use"]')!;
            const thinking = root.querySelector('[data-message-content-block="thinking"]')!;
            const toolRow = tool.querySelector('[data-chat-operational-row]')!;
            const thinkingRow = thinking.querySelector('[data-chat-operational-row]')!;
            return {
              gap: thinkingRow.getBoundingClientRect().top - toolRow.getBoundingClientRect().bottom,
            };
          });
        expect(operationalGeometry.gap).toBeCloseTo(0, 1);

        for (const testId of ['reasoning-response-boundary', 'streaming-response-boundary']) {
          const responseGap = await component.getByTestId(testId).evaluate((root) => {
            const thinking = root.querySelector('[data-message-content-block="thinking"]')!;
            const response = root.querySelector(
              '[data-message-content-block="text"] .markdown-viewer > :first-child',
            )!;
            return response.getBoundingClientRect().top - thinking.getBoundingClientRect().bottom;
          });
          expect(responseGap, testId).toBeCloseTo(24 * zoom, 1);
        }

        const consecutiveReasoning = component.getByTestId('consecutive-reasoning-boundary');
        const reasoningDisclosures = consecutiveReasoning.getByTestId('reasoning-disclosure');
        await expect(reasoningDisclosures).toHaveCount(2);
        await reasoningDisclosures.nth(0).click();
        await reasoningDisclosures.nth(1).click();
        await consecutiveReasoning.evaluate(async (root) => {
          await Promise.all(
            root.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
        const reasoningGroupGap = await consecutiveReasoning.evaluate((root) => {
          const groups = [
            ...root.querySelectorAll<HTMLElement>('[data-testid="reasoning-tool-call"]'),
          ];
          const secondRow = groups[1].querySelector<HTMLElement>(
            '[data-operational-disclosure-row]',
          )!;
          return secondRow.getBoundingClientRect().top - groups[0].getBoundingClientRect().bottom;
        });
        expect(reasoningGroupGap).toBeCloseTo(56 * zoom, 1);
        const expandedBottomGap = () =>
          consecutiveReasoning.evaluate((root) => {
            const details = root.querySelector<HTMLElement>('[data-operational-expanded-content]')!;
            const body = details.querySelector<HTMLElement>('[data-reasoning-expanded-body]')!;
            return details.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom;
          });
        await expect.poll(expandedBottomGap).toBeCloseTo(8 * zoom, 1);

        const attention = component.getByTestId('attention-card-boundary');
        const disclosure = attention.getByTestId('reasoning-disclosure');
        await expect(disclosure).toContainText('Considering task restoration');
        const gap = async () =>
          attention.evaluate((root) => {
            const card = root.querySelector('[data-testid="attention-card"]')!;
            const thinking = root.querySelector('[data-testid="reasoning-tool-call"]')!;
            return thinking.getBoundingClientRect().top - card.getBoundingClientRect().bottom;
          });
        expect(await gap()).toBeCloseTo(20 * zoom, 1);
        await disclosure.click();
        await page.waitForTimeout(180);
        expect(await gap()).toBeCloseTo(20 * zoom, 1);
        await disclosure.click();
        await page.waitForTimeout(180);
        expect(await gap()).toBeCloseTo(20 * zoom, 1);

        await component.update({
          props: { theme, width, zoom, showStreamingThinking: false },
        });
        await expect(
          component.getByTestId('streaming-boundary').getByTestId('reasoning-tool-call'),
        ).toHaveCount(0);
        await component.update({ props: { theme, width, zoom, showStreamingThinking: true } });
        const streamingGap = await component.getByTestId('streaming-boundary').evaluate((root) => {
          const thinking = root.querySelector('[data-testid="reasoning-tool-call"]')!;
          const wrapper = thinking.closest('.content-block--thinking')!;
          return (
            thinking.getBoundingClientRect().top -
            wrapper.previousElementSibling!.getBoundingClientRect().bottom
          );
        });
        expect(streamingGap).toBeCloseTo(16 * zoom, 1);
      });
    }
  }
}

test('leaves no stale Thinking boundary motion with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ThinkingSpacingGeometryHost);
  const disclosure = component
    .getByTestId('attention-card-boundary')
    .getByTestId('reasoning-disclosure');
  await disclosure.click();
  const details = component
    .getByTestId('attention-card-boundary')
    .locator('[data-operational-expanded-content]');
  await expect(details).toBeVisible();
  await expect.poll(() => details.evaluate((element) => element.getAnimations().length)).toBe(0);
});

for (const renderer of ['message', 'streaming'] as const) {
  // Preserve the existing normal-size and narrow/zoomed theme contracts.
  for (const dimensions of [
    { theme: 'light' as const, width: 720, zoom: 1 },
    { theme: 'dark' as const, width: 320, zoom: 2 },
  ]) {
    test(`compacts standalone explicit titles and tools in ${renderer} ${dimensions.theme} at ${dimensions.width}px and ${dimensions.zoom * 100}%`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const props = { renderer, ...dimensions };
      let component = await mount(ThinkingSpacingGeometryHost, {
        props: {
          ...props,
          regressionContent: titleToolHistory('standalone', false),
          isStreaming: true,
        },
      });
      const verify = async (state: string) => {
        const fixture = component.getByTestId('compact-reasoning-fixture');
        const geometry = await recordReasoningGeometry(fixture, `${renderer}-standalone-${state}`);
        expect.soft(geometry).toHaveLength(5);
        const thinkingRows = fixture.locator(
          '[data-message-content-block="thinking"] [data-operational-summary]',
        );
        expect
          .soft((await thinkingRows.allTextContents()).map((text) => text.trim()))
          .toEqual([...growthTitles, followingTitle, 'Validating renderer output']);
        expect.soft(await fixture.getByTestId('reasoning-disclosure').count()).toBe(0);
        await expect(fixture.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
        await expect(fixture.locator('[data-tool-use-id]')).toHaveCount(1);
        for (const row of geometry) {
          expect(row.height).toBeCloseTo(28 * dimensions.zoom, 1);
          if (row.gap !== null) expect.soft(row.gap, `${state}: ${row.text}`).toBeCloseTo(0, 1);
          expect(row.summaryX).toBeCloseTo(geometry[0].summaryX!, 1);
        }
        if (state === 'live' || state === 'remounted')
          await captureReasoning(fixture, `${renderer}-standalone-${state}`);
      };
      await verify('live');
      const completed = {
        ...props,
        regressionContent: titleToolHistory('standalone', true),
        isStreaming: false,
      };
      await component.update({ props: completed });
      await verify('completed');
      await component.unmount();
      component = await mount(ThinkingSpacingGeometryHost, { props: completed });
      await verify('remounted');
    });
  }

  test(`removes only the standalone title-only pair gap in ${renderer}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ThinkingSpacingGeometryHost, {
      props: {
        renderer,
        regressionContent: [
          thinking('pair:first', '# Preparing task plan'),
          thinking('pair:second', '# Checking duplicate tracker issue'),
        ],
      },
    });
    const fixture = component.getByTestId('compact-reasoning-fixture');
    const rows = await recordReasoningGeometry(fixture, `${renderer}-standalone-title-pair`);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.height)).toEqual([28, 28]);
    expect(await thinkingBoundaryGap(fixture)).toBeCloseTo(0, 1);
  });

  test(`preserves standalone tool adjacency across a hidden paired result in ${renderer}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ThinkingSpacingGeometryHost, {
      props: {
        renderer,
        regressionContent: [
          thinking('tools:first', '# Preparing task plan'),
          {
            type: 'tool_use',
            id: 'tools:use',
            toolCallId: 'tools:call',
            name: 'view',
            input: { path: 'src/example.ts' },
          },
          {
            type: 'tool_result',
            id: 'tools:result',
            tool_use_id: 'tools:call',
            output: 'Paired source result',
          },
          thinking('tools:second', '# Checking duplicate tracker issue'),
        ],
      },
    });
    const fixture = component.getByTestId('compact-reasoning-fixture');
    const rows = await recordReasoningGeometry(fixture, `${renderer}-standalone-tool-pairs`);
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row) => row.gap)).toEqual([0, 0]);
    expect(rows.map((row) => row.height)).toEqual([28, 28, 28]);
    await expect(fixture.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
    expect(rows.map((row) => row.type)).toEqual(['thinking', 'tool_use', 'thinking']);
    await assertContentOnceInOrder(fixture, growthTitles);
  });

  for (const previousHasBody of [false, true]) {
    test(`preserves 56px standalone ${previousHasBody ? 'body-to-title' : 'title-to-body'} boundary even when collapsed in ${renderer}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const content = [
        thinking(
          'mixed:first',
          `# Preparing task plan${previousHasBody ? '\n\nFirst supplied body.' : ''}`,
        ),
        thinking(
          'mixed:second',
          `# Checking duplicate tracker issue${previousHasBody ? '' : '\n\nSecond supplied body.'}`,
        ),
      ];
      const component = await mount(ThinkingSpacingGeometryHost, {
        props: { renderer, regressionContent: content },
      });
      const fixture = component.getByTestId('compact-reasoning-fixture');
      const verifyGap = async (state: string) => {
        await settleReasoning(fixture);
        await recordReasoningGeometry(
          fixture,
          `${renderer}-standalone-mixed-${previousHasBody}-${state}`,
        );
        expect(await thinkingBoundaryGap(fixture)).toBeCloseTo(56, 1);
      };
      await verifyGap('collapsed');
      const bodyBlock = fixture
        .locator('[data-message-content-block="thinking"]')
        .nth(previousHasBody ? 0 : 1);
      const disclosure = bodyBlock.getByRole('button');
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(bodyBlock).toContainText(
        previousHasBody ? 'First supplied body.' : 'Second supplied body.',
      );
      await verifyGap('expanded');
      await page.keyboard.press('Space');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(disclosure).toBeFocused();
      await verifyGap('recollapsed');
    });
  }

  for (const shape of ['single', 'multiple'] as const) {
    test(`preserves standalone ${shape} same-block growth through completion, reopening and remount in ${renderer}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const props = { renderer, width: 560, zoom: 1 };
      let component = await mount(ThinkingSpacingGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('standalone', shape, 'titles'),
          isStreaming: true,
        },
      });
      const verify = async (
        stage: 'titles' | 'body' | 'following' | 'completed',
        state: string = stage,
      ) => {
        const fixture = component.getByTestId('compact-reasoning-fixture');
        await openReasoning(fixture);
        await assertContentOnceInOrder(fixture, [
          ...(shape === 'single' ? growthTitles.slice(0, 1) : growthTitles),
          ...(stage === 'titles' ? [] : growthBody.split('\n\n')),
          ...(stage === 'following' || stage === 'completed' ? [followingTitle] : []),
        ]);
        await recordReasoningGeometry(fixture, `${renderer}-standalone-${shape}-${state}`);
        if (stage === 'following' || stage === 'completed') {
          expect(await thinkingBoundaryGap(fixture)).toBeCloseTo(56, 1);
        }
        if (state === 'remounted')
          await captureReasoning(fixture, `${renderer}-standalone-${shape}-body`);
      };
      await verify('titles');
      for (const stage of ['body', 'following', 'completed'] as const) {
        await component.update({
          props: {
            ...props,
            regressionContent: growingHistory('standalone', shape, stage),
            isStreaming: stage !== 'completed',
          },
        });
        await verify(stage);
      }
      const toggle = component.getByTestId('reasoning-disclosure').first();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(component).not.toContainText(growthBody.split('\n\n')[0]);
      await toggle.click();
      await verify('completed', 'reopened');
      await component.unmount();
      component = await mount(ThinkingSpacingGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('standalone', shape, 'completed'),
          isStreaming: false,
        },
      });
      await verify('completed', 'remounted');
    });
  }
}
