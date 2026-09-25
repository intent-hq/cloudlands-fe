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
  activityRowSelector,
  assertContentOnceInOrder,
  openReasoning,
} from './compact-reasoning-helpers';

test('removes and restores streamed reasoning when its content changes', async ({ mount }) => {
  const component = await mount(ThinkingSpacingGeometryHost);
  const reasoning = component.getByTestId('streaming-boundary').getByTestId('reasoning-tool-call');
  await expect(reasoning).toHaveCount(1);
  await component.update({ props: { showStreamingThinking: false } });
  await expect(reasoning).toHaveCount(0);
  await component.update({ props: { showStreamingThinking: true } });
  await expect(reasoning).toHaveCount(1);
});

test('finishes disclosure expansion with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ThinkingSpacingGeometryHost);
  const disclosure = component
    .getByTestId('reasoning-disclosure-fixture')
    .getByTestId('reasoning-disclosure');
  await expect(disclosure).toContainText('Considering task restoration');
  await disclosure.click();
  const details = component
    .getByTestId('reasoning-disclosure-fixture')
    .locator('[data-operational-expanded-content]');
  await expect(details).toBeVisible();
  await expect.poll(() => details.evaluate((element) => element.getAnimations().length)).toBe(0);
});

for (const renderer of ['message', 'streaming'] as const) {
  test(`preserves standalone explicit titles and tools through completion and remount in ${renderer}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const props = { renderer };
    let component = await mount(ThinkingSpacingGeometryHost, {
      props: {
        ...props,
        regressionContent: titleToolHistory('standalone', false),
        isStreaming: true,
      },
    });
    const verify = async () => {
      const fixture = component.getByTestId('compact-reasoning-fixture');
      await expect(fixture.locator(activityRowSelector)).toHaveCount(5);
      const thinkingRows = fixture.locator(
        '[data-message-content-block="thinking"] [data-operational-summary]',
      );
      expect
        .soft((await thinkingRows.allTextContents()).map((text) => text.trim()))
        .toEqual([...growthTitles, followingTitle, 'Validating renderer output']);
      expect.soft(await fixture.getByTestId('reasoning-disclosure').count()).toBe(0);
      await expect(fixture.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
      await expect(fixture.locator('[data-tool-use-id]')).toHaveCount(1);
    };
    await verify();
    const completed = {
      ...props,
      regressionContent: titleToolHistory('standalone', true),
      isStreaming: false,
    };
    await component.update({ props: completed });
    await verify();
    await component.unmount();
    component = await mount(ThinkingSpacingGeometryHost, { props: completed });
    await verify();
  });

  test(`preserves standalone tool order across a hidden paired result in ${renderer}`, async ({
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
    const rows = fixture.locator(activityRowSelector);
    await expect(rows).toHaveCount(3);
    await expect(fixture.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((row) =>
          row.closest('[data-message-content-block]')?.getAttribute('data-message-content-block'),
        ),
      ),
    ).toEqual(['thinking', 'tool_use', 'thinking']);
    await assertContentOnceInOrder(fixture, growthTitles);
  });

  for (const previousHasBody of [false, true]) {
    test(`preserves keyboard disclosure for standalone ${previousHasBody ? 'body-to-title' : 'title-to-body'} content in ${renderer}`, async ({
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
      await page.keyboard.press('Space');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(disclosure).toBeFocused();
    });
  }

  for (const shape of ['single', 'multiple'] as const) {
    test(`preserves standalone ${shape} same-block growth through completion, reopening and remount in ${renderer}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const props = { renderer };
      let component = await mount(ThinkingSpacingGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('standalone', shape, 'titles'),
          isStreaming: true,
        },
      });
      const verify = async (stage: 'titles' | 'body' | 'following' | 'completed') => {
        const fixture = component.getByTestId('compact-reasoning-fixture');
        await openReasoning(fixture);
        await assertContentOnceInOrder(fixture, [
          ...(shape === 'single' ? growthTitles.slice(0, 1) : growthTitles),
          ...(stage === 'titles' ? [] : growthBody.split('\n\n')),
          ...(stage === 'following' || stage === 'completed' ? [followingTitle] : []),
        ]);
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
      await verify('completed');
      await component.unmount();
      component = await mount(ThinkingSpacingGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('standalone', shape, 'completed'),
          isStreaming: false,
        },
      });
      await verify('completed');
    });
  }
}
