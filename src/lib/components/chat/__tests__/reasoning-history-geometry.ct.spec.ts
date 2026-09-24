import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import ReasoningHistoryGeometryHost from './ReasoningHistoryGeometryHost.svelte';
import {
  followingTitle,
  growingHistory,
  growthBody,
  growthTitles,
  thinking,
  titleToolHistory,
  withReasoningLayout,
} from './compact-reasoning-fixtures';
import {
  activityRowSelector,
  assertContentOnceInOrder,
  captureReasoning,
  openReasoning,
  recordReasoningGeometry,
  settleReasoning,
  thinkingBoundaryGap,
} from './compact-reasoning-geometry';

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

async function assertExpandedFixture(fixture: Locator, zoom: number, includeAnswer: boolean) {
  const group = fixture.getByTestId('response-group');
  const children = group.locator('[data-response-group-child]');
  await expect(children).toHaveCount(5);
  expect(
    await children.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-message-content-block')),
    ),
  ).toEqual(['text', 'thinking', 'thinking', 'tool_use', 'thinking']);
  expect
    .soft(
      await children.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).paddingTop),
      ),
    )
    .toEqual(['0px', '16px', '24px', '0px', '0px']);

  const sections = group.locator('[data-reasoning-section]');
  await expect(sections).toHaveCount(4);
  expect
    .soft(
      await sections.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).paddingTop),
      ),
    )
    .toEqual(['0px', '0px', '0px', '0px']);

  const titles = group.locator('[data-reasoning-section-title]');
  await expect(titles).toHaveCount(3);
  expect(await titles.allTextContents()).toEqual(expectedTitles);
  const seams = await titles.evaluateAll((elements) =>
    elements.map((title) => {
      const section = title.closest<HTMLElement>('[data-reasoning-section]')!;
      const row = title.closest<HTMLElement>('[data-chat-operational-row]')!;
      const child = section.closest<HTMLElement>('[data-response-group-child]')!;
      const previous =
        (section.previousElementSibling as HTMLElement | null) ??
        (child.previousElementSibling as HTMLElement | null);
      return {
        title: title.textContent?.trim(),
        seam: row.getBoundingClientRect().top - previous!.getBoundingClientRect().bottom,
      };
    }),
  );
  expect(seams.map(({ title }) => title)).toEqual(expectedTitles);
  await test
    .info()
    .attach('nested-mixed-seams', { body: JSON.stringify(seams), contentType: 'application/json' });
  for (const [index, { seam, title }] of seams.entries()) {
    expect.soft(seam, title).toBeCloseTo((index === 0 ? 24 : 0) * zoom, 1);
  }

  const bodyGeometry = await group
    .locator('[data-reasoning-history-body]')
    .evaluateAll((elements) =>
      elements.map((body) => {
        const section = body.closest<HTMLElement>('[data-reasoning-section]')!;
        const row = section.querySelector<HTMLElement>('[data-chat-operational-row]');
        return {
          rowToBody: row
            ? body.getBoundingClientRect().top - row.getBoundingClientRect().bottom
            : null,
          paddingTop: getComputedStyle(body).paddingTop,
          paddingBottom: getComputedStyle(body).paddingBottom,
        };
      }),
    );
  expect(bodyGeometry).toEqual([
    { rowToBody: null, paddingTop: '6px', paddingBottom: '8px' },
    { rowToBody: 0, paddingTop: '6px', paddingBottom: '8px' },
    { rowToBody: 0, paddingTop: '6px', paddingBottom: '8px' },
  ]);

  const titleXs = await titles.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().x),
  );
  const toolX = await group
    .locator('[data-message-content-block="tool_use"] [data-tool-sentence]')
    .evaluate((element) => element.getBoundingClientRect().x);
  for (const titleX of titleXs) expect(titleX).toBeCloseTo(toolX, 1);
  const guideAndIcon = await group.evaluate((element) => {
    const guide = element.querySelector<HTMLElement>('[data-operational-expanded-guide]')!;
    const icon = element.querySelector<HTMLElement>(
      '[data-testid="response-group-disclosure"] [data-operational-leading] svg',
    )!;
    const center = (node: HTMLElement) => {
      const box = node.getBoundingClientRect();
      return box.x + box.width / 2;
    };
    return { guide: center(guide), icon: center(icon) };
  });
  expect(guideAndIcon.guide).toBeCloseTo(guideAndIcon.icon, 1);

  const titleThenToolGap = await children.evaluateAll((elements) => {
    const titleChild = elements[2].getBoundingClientRect();
    const toolChild = elements[3].getBoundingClientRect();
    return toolChild.top - titleChild.bottom;
  });
  expect(titleThenToolGap).toBeCloseTo(0, 1);

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
    const answerContent = answerBlock.locator('p').first();
    await expect(answerBlock).toContainText('Final assistant answer.');
    // Measure the group and the answer in one frame and wait for the freshly
    // expanded group to settle: separate boundingBox() round trips can
    // straddle a layout pass and misreport the seam under load.
    const groupHandle = await group.elementHandle();
    await expect
      .poll(() =>
        answerContent.evaluate(
          (answer, groupElement) =>
            answer.getBoundingClientRect().top - groupElement!.getBoundingClientRect().bottom,
          groupHandle,
        ),
      )
      .toBeCloseTo(28 * zoom, 1);
    expect(await group.evaluate((element) => getComputedStyle(element).marginBottom)).toBe('12px');
    expect(await answerBlock.evaluate((element) => getComputedStyle(element).paddingTop)).toBe(
      '16px',
    );
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      test(`locks ${theme} nested reasoning seams at ${width}px and ${zoom * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const component = await mount(ReasoningHistoryGeometryHost, {
          props: { theme, width, zoom, phase: 'completed' },
        });

        expect((await component.boundingBox())!.width).toBeCloseTo(width * zoom, 1);
        for (const renderer of rendererIds) {
          const fixture = component.getByTestId(`${renderer}-titled`);
          await openGroup(fixture);
          const details = fixture.locator('[data-operational-expanded-content]');
          await expect(details).toBeVisible();
          await expect
            .poll(() => details.evaluate((element) => element.getAnimations().length))
            .toBe(0);
          await assertExpandedFixture(fixture, zoom, true);

          const inline = component.getByTestId(`${renderer}-inline`);
          await expect(inline.getByTestId('response-group')).toHaveCount(0);
          await expect(inline.locator('[data-reasoning-section-boundary]')).toHaveCount(0);
          const inlineBlocks = inline
            .locator('[data-operational-stack]')
            .first()
            .locator(':scope > [data-message-content-block]');
          expect(
            await inlineBlocks.evaluateAll((elements) =>
              elements.map((element) => ({
                type: element.getAttribute('data-message-content-block'),
                paddingTop: getComputedStyle(element).paddingTop,
              })),
            ),
          ).toEqual([
            { type: 'text', paddingTop: '0px' },
            { type: 'thinking', paddingTop: '16px' },
            { type: 'thinking', paddingTop: '0px' },
            { type: 'text', paddingTop: '16px' },
          ]);
          const inlineText = (await inline.textContent()) ?? '';
          for (const value of [
            'Inline group description.',
            'Headingless predecessor remains inline without a disclosure.',
            'Later headingless reasoning stays in source order.',
            'Inline final prose.',
          ]) {
            expect(inlineText.match(new RegExp(value.replace('.', '\\.'), 'g'))).toHaveLength(1);
          }
        }
      });
    }
  }
}

test('keeps exact seams through live streaming completion in both renderers', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let component = await mount(ReasoningHistoryGeometryHost, {
    props: { width: 560, zoom: 1, phase: 'live' },
  });

  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    await openGroup(fixture);
    await assertExpandedFixture(fixture, 1, false);
  }

  await component.update({ props: { width: 560, zoom: 1, phase: 'completed' } });
  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    const disclosure = fixture.getByTestId('response-group-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await assertExpandedFixture(fixture, 1, true);
  }

  await component.unmount();
  component = await mount(ReasoningHistoryGeometryHost, {
    props: { width: 560, zoom: 1, phase: 'completed' },
  });
  for (const renderer of rendererIds) {
    const fixture = component.getByTestId(`${renderer}-titled`);
    await openGroup(fixture);
    await assertExpandedFixture(fixture, 1, true);
  }
});

test('search reveal restores automatic state but preserves manual disclosure state', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ReasoningHistoryGeometryHost, {
    props: { width: 560, zoom: 1, phase: 'completed' },
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
  test(`compacts screenshot titles and tools through group lifecycle in ${renderer}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const props = { renderer, width: 720, zoom: 1 };
    let component = await mount(ReasoningHistoryGeometryHost, {
      props: { ...props, regressionContent: titleToolHistory('nested', false), phase: 'live' },
    });
    const verify = async (state: string) => {
      const fixture = component.getByTestId('compact-reasoning-fixture');
      await openReasoning(fixture);
      await assertContentOnceInOrder(fixture, [
        ...growthTitles,
        followingTitle,
        'Validating renderer output',
      ]);
      await expect(fixture.locator('[data-message-content-block="tool_result"]')).toHaveCount(0);
      await expect(fixture.getByTestId('reasoning-disclosure')).toHaveCount(0);
      const rows = await recordReasoningGeometry(fixture, `${renderer}-nested-${state}`);
      expect(rows).toHaveLength(5);
      expect(rows.map((row) => row.type)).toEqual([
        'thinking',
        'thinking',
        'thinking',
        'tool_use',
        'thinking',
      ]);
      for (const row of rows) {
        expect(row.height).toBeCloseTo(28, 1);
        if (row.gap !== null) expect.soft(row.gap, `${state}: ${row.text}`).toBeCloseTo(0, 1);
      }
      for (const row of rows) {
        expect(row.summaryX).toBeCloseTo(rows[0].summaryX!, 1);
        expect(row.iconWidth).toBeCloseTo(16, 1);
      }
      if (state === 'live' || state === 'remounted')
        await captureReasoning(fixture, `${renderer}-nested-${state}`);
    };
    await verify('live');
    const completed = {
      ...props,
      regressionContent: titleToolHistory('nested', true),
      phase: 'completed' as const,
    };
    await component.update({ props: completed });
    const toggle = component.getByTestId('response-group-disclosure');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await verify('completed');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(component.locator(activityRowSelector)).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await verify('reopened');
    await component.unmount();
    component = await mount(ReasoningHistoryGeometryHost, { props: completed });
    await verify('remounted');
  });

  for (const shape of ['single', 'multiple'] as const) {
    test(`keeps nested ${shape} title-to-body growth and 24px body boundaries in ${renderer}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const props = { renderer, width: 560, zoom: 1 };
      let component = await mount(ReasoningHistoryGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('nested', shape, 'titles'),
          phase: 'live',
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
        const rows = await recordReasoningGeometry(fixture, `${renderer}-nested-${shape}-${state}`);
        for (const row of rows) expect(row.height).toBeCloseTo(28, 1);
        if (shape === 'multiple')
          expect
            .soft(rows[1].gap, 'title-only to title-plus-body within one block')
            .toBeCloseTo(0, 1);
        if (stage !== 'titles') {
          const body = fixture.locator('[data-reasoning-history-body]');
          await expect(body).toHaveCount(1);
          const inset = await body.evaluate((element) => {
            const row = element.previousElementSibling!;
            const paragraph = element.querySelector('p')!;
            return {
              top: paragraph.getBoundingClientRect().top - row.getBoundingClientRect().bottom,
              bottom:
                element.getBoundingClientRect().bottom -
                element.lastElementChild!.getBoundingClientRect().bottom,
            };
          });
          expect(inset).toEqual({ top: 6, bottom: 8 });
        }
        if (stage === 'following' || stage === 'completed') {
          expect(await thinkingBoundaryGap(fixture)).toBeCloseTo(24, 1);
        }
        if (state === 'remounted')
          await captureReasoning(fixture, `${renderer}-nested-${shape}-body`);
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
      await verify('completed', 'reopened');
      await component.unmount();
      component = await mount(ReasoningHistoryGeometryHost, {
        props: {
          ...props,
          regressionContent: growingHistory('nested', shape, 'completed'),
          phase: 'completed',
        },
      });
      await verify('completed', 'remounted');
    });
  }

  for (const previousHasBody of [false, true]) {
    test(`nested mixed boundary follows preceding ${previousHasBody ? 'body' : 'title'} in ${renderer}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const children = [
        thinking(
          'mixed:first',
          `**Preparing task plan**${previousHasBody ? '\n\nFirst supplied body.' : ''}`,
        ),
        thinking(
          'mixed:second',
          `**Checking duplicate tracker issue**${previousHasBody ? '' : '\n\nSecond supplied body.'}`,
        ),
      ];
      const component = await mount(ReasoningHistoryGeometryHost, {
        props: {
          renderer,
          regressionContent: withReasoningLayout(children, 'nested', true),
        },
      });
      const fixture = component.getByTestId('compact-reasoning-fixture');
      await openReasoning(fixture);
      await recordReasoningGeometry(fixture, `${renderer}-nested-mixed-${previousHasBody}`);
      await expect(fixture.locator('[data-reasoning-history-body]')).toHaveCount(1);
      expect(await thinkingBoundaryGap(fixture)).toBeCloseTo(previousHasBody ? 24 : 0, 1);
      await settleReasoning(fixture);
    });
  }
}
