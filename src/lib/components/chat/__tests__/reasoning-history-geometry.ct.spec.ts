import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import ReasoningHistoryGeometryHost from './ReasoningHistoryGeometryHost.svelte';
import {
  followingTitle,
  growingHistory,
  growthBody,
  growthTitles,
  titleToolHistory,
} from './compact-reasoning-fixtures';
import {
  activityRowSelector,
  assertContentOnceInOrder,
  openReasoning,
} from './compact-reasoning-helpers';

test.setTimeout(120_000);

const rendererIds = ['message', 'streaming'] as const;
const expectedTitles = [
  'Specifying task requirements',
  'Checking detailed constraints',
  'Validating renderer output',
];

async function openGroup(fixture: Locator): Promise<Locator> {
  const disclosure = fixture.getByTestId('response-group-disclosure');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  return disclosure;
}

async function assertExpandedFixture(fixture: Locator, includeAnswer: boolean) {
  const group = fixture.getByTestId('response-group');
  const children = group.locator('[data-response-group-child]');
  await expect(children).toHaveCount(5);
  expect(
    await children.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-message-content-block')),
    ),
  ).toEqual(['text', 'thinking', 'thinking', 'tool_use', 'thinking']);
  const sections = group.locator('[data-reasoning-section]');
  await expect(sections).toHaveCount(4);

  const titles = group.locator('[data-reasoning-section-title]');
  await expect(titles).toHaveCount(3);
  expect(await titles.allTextContents()).toEqual(expectedTitles);
  await expect(group).toContainText('The production-path analysis ends with input.');
  await expect(group).toContainText('Final nested reasoning prose.');
  await expect(group.locator('li')).toHaveCount(2);
  await expect(group.locator('pre code')).toContainText("const seam = 'token';");
  const text = (await group.textContent()) ?? '';
  expect(text).toMatch(/input\.\s+Specifying task requirements/);
  expect(text).not.toContain('input.Specifying task requirements');
  expect(text).toMatch(/Specifying task requirements\s+Checking detailed constraints/);
  const orderedContent = [
    'Reviewing the recorded input.',
    'The production-path analysis ends with input.',
    'Specifying task requirements',
    'Checking detailed constraints',
    'Required steps:',
    'preserve source order',
    'keep tool results paired',
    'Validating renderer output',
    'Final nested reasoning prose.',
  ];
  let previousIndex = -1;
  for (const content of orderedContent) {
    const escaped = content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(text.match(new RegExp(escaped, 'g'))).toHaveLength(1);
    const index = text.indexOf(content);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }

  if (includeAnswer) {
    const stack = fixture.locator('[data-operational-stack]').first();
    const answerBlock = stack.locator(':scope > [data-message-content-block="text"]');
    await expect(answerBlock).toContainText('Final assistant answer.');
  }
}

test('preserves nested and inline content in both renderers', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ReasoningHistoryGeometryHost, {
    props: { phase: 'completed' },
  });

  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    await openGroup(fixture);
    const details = fixture.locator('[data-operational-expanded-content]');
    await expect(details).toBeVisible();
    await expect.poll(() => details.evaluate((element) => element.getAnimations().length)).toBe(0);
    await assertExpandedFixture(fixture, true);

    const inline = component.getByTestId(`${renderer}-inline`);
    await expect(inline.getByTestId('response-group')).toHaveCount(0);
    await expect(inline.locator('[data-reasoning-section-boundary]')).toHaveCount(0);
    const inlineText = (await inline.textContent()) ?? '';
    for (const value of [
      'Inline group description.',
      'Headingless predecessor remains inline without a disclosure.',
      'Later headingless reasoning stays in source order.',
      'Inline final prose.',
    ]) {
      expect(inlineText.split(value)).toHaveLength(2);
    }
  }
});

test('preserves nested content through streaming completion and remount in both renderers', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let component = await mount(ReasoningHistoryGeometryHost, {
    props: { phase: 'live' },
  });

  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    await openGroup(fixture);
    await assertExpandedFixture(fixture, false);
  }

  await component.update({ props: { phase: 'completed' } });
  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    const disclosure = fixture.getByTestId('response-group-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await assertExpandedFixture(fixture, true);
  }

  await component.unmount();
  component = await mount(ReasoningHistoryGeometryHost, {
    props: { phase: 'completed' },
  });
  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    await openGroup(fixture);
    await assertExpandedFixture(fixture, true);
  }
});

test('search reveal restores automatic state but preserves manual disclosure state', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ReasoningHistoryGeometryHost, {
    props: { phase: 'completed' },
  });

  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    const group = fixture.locator('[data-chat-search-disclosure-id^="group:"]');
    const disclosure = fixture.getByTestId('response-group-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await group.evaluate((element) => element.dispatchEvent(new CustomEvent('chatsearchexpand')));
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await group.evaluate((element) => element.dispatchEvent(new CustomEvent('chatsearchrestore')));
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await disclosure.click();
    await group.evaluate((element) => element.dispatchEvent(new CustomEvent('chatsearchexpand')));
    await group.evaluate((element) => element.dispatchEvent(new CustomEvent('chatsearchrestore')));
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  }
});

for (const renderer of rendererIds) {
  test(`preserves titles and tools through group lifecycle in ${renderer}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const props = { renderer };
    let component = await mount(ReasoningHistoryGeometryHost, {
      props: { ...props, regressionContent: titleToolHistory('nested', false), phase: 'live' },
    });
    const verify = async () => {
      const fixture = component.getByTestId('compact-reasoning-fixture');
      await openReasoning(fixture);
      await assertContentOnceInOrder(fixture, [
        ...growthTitles,
        followingTitle,
        'Validating renderer output',
      ]);
      await expect(fixture.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
      await expect(fixture.getByTestId('reasoning-disclosure')).toHaveCount(0);
      const rows = fixture.locator(activityRowSelector);
      await expect(rows).toHaveCount(5);
      expect(
        await rows.evaluateAll((elements) =>
          elements.map((row) =>
            row.closest('[data-message-content-block]')?.getAttribute('data-message-content-block'),
          ),
        ),
      ).toEqual(['thinking', 'thinking', 'thinking', 'tool_use', 'thinking']);
    };
    await verify();
    const completed = {
      ...props,
      regressionContent: titleToolHistory('nested', true),
      phase: 'completed' as const,
    };
    await component.update({ props: completed });
    const toggle = component.getByTestId('response-group-disclosure');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await verify();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(component.locator(activityRowSelector)).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await verify();
    await component.unmount();
    component = await mount(ReasoningHistoryGeometryHost, { props: completed });
    await verify();
  });

  for (const shape of ['single', 'multiple'] as const) {
    test(`preserves nested ${shape} title-to-body growth in ${renderer}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const props = { renderer };
      let component = await mount(ReasoningHistoryGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('nested', shape, 'titles'),
          phase: 'live',
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
        if (stage !== 'titles') {
          await expect(fixture.locator('[data-reasoning-history-body]')).toHaveCount(1);
        }
      };
      await verify('titles');
      for (const stage of ['body', 'following', 'completed'] as const) {
        await component.update({
          props: {
            ...props,
            regressionContent: growingHistory('nested', shape, stage),
            phase: stage === 'completed' ? 'completed' : 'live',
          },
        });
        await verify(stage);
      }
      const toggle = component.getByTestId('response-group-disclosure');
      await toggle.click();
      await expect(component.locator('[data-reasoning-history-body]')).toHaveCount(0);
      await toggle.click();
      await verify('completed');
      await component.unmount();
      component = await mount(ReasoningHistoryGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('nested', shape, 'completed'),
          phase: 'completed',
        },
      });
      await verify('completed');
    });
  }
}
