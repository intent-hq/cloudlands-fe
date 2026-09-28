import type { AgentMessage, ContentBlock, PendingProposalRef } from '$shared/types';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

const proposal: WorkspaceCreateProposal = {
  kind: 'workspace-create',
  applyToolCallId: 'pending-streaming-proposal',
  payload: {
    operation: 'workspace.create',
    params: { title: 'Review streaming follow-up', initialPrompt: 'Inspect the follow-up task.' },
  },
  preview: {
    title: 'Review streaming follow-up',
    workspaceCreate: {
      mode: 'sibling',
      title: 'Review streaming follow-up',
      initialPrompt: 'Inspect the follow-up task.',
    },
  },
};
const pendingProposals: PendingProposalRef[] = [
  { proposalId: 'pending-streaming-proposal', messageId: 'history-1' },
];
const history: AgentMessage[] = Array.from({ length: 40 }, (_, index) => ({
  id: `history-${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  timestamp: '2026-09-23T12:00:00.000Z',
  contentBlocks:
    index === 1
      ? [
          {
            type: 'resource',
            resource: createProposalResource(proposal),
          } as unknown as ContentBlock,
        ]
      : [{ type: 'text', text: `Historical message ${index}. ${'Earlier context. '.repeat(24)}` }],
})) as AgentMessage[];

function messages(step: number): AgentMessage[] {
  return [
    ...history,
    {
      id: 'live-prompt',
      role: 'user',
      timestamp: '2026-09-23T12:01:00.000Z',
      contentBlocks: [{ type: 'text', text: 'Continue the response while the proposal waits.' }],
    } as AgentMessage,
    {
      id: 'live-response',
      role: 'assistant',
      timestamp: '2026-09-23T12:01:01.000Z',
      isStreaming: true,
      streamingComplete: false,
      contentBlocks: [
        {
          type: 'text',
          id: 'live-text',
          text: Array.from(
            { length: step + 1 },
            (_, index) => `Stream segment ${index}. ${'More streamed output. '.repeat(5)}`,
          ).join('\n\n'),
        },
      ],
    } as AgentMessage,
  ];
}

interface Sample {
  source: 'initial' | 'mutation' | 'resize' | 'frame';
  step: number;
  chipPresent: boolean;
  viewportHeight: number;
  distance: number;
  tailHeight: number;
}

type SampledHost = HTMLElement & {
  pendingProposalProbe?: {
    samples: Sample[];
    removedChips: number;
    step: number;
    stop: () => void;
  };
};

test('keeps the pending-proposal chip and transcript height stable during cumulative output', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 960, height: 1000 });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { width: 560, liveMessages: messages(0), pendingProposals },
  });
  const scroll = host.getByTestId('chat-transcript-scroll-viewport');
  const live = host.locator('[data-message-id="live-response"]');
  await expect(live).toContainText('Stream segment 0.');
  await expect(host.getByTestId('pending-proposal-chip')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);

  await host.evaluate((node) => {
    const root = node as SampledHost;
    const viewport = root.querySelector<HTMLElement>(
      '[data-testid="chat-transcript-scroll-viewport"]',
    )!;
    const chipSelector = '[data-testid="pending-proposal-chip"]';
    let frameId = 0;
    const probe = {
      samples: [] as Sample[],
      removedChips: 0,
      step: 0,
      stop: () => {
        recordMutations(mutations.takeRecords());
        mutations.disconnect();
        resizes.disconnect();
        cancelAnimationFrame(frameId);
      },
    };
    root.pendingProposalProbe = probe;
    const sample = (source: Sample['source']) => {
      probe.samples.push({
        source,
        step: probe.step,
        chipPresent: !!root.querySelector(chipSelector),
        viewportHeight: viewport.getBoundingClientRect().height,
        distance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        tailHeight:
          viewport.querySelector('[data-message-id="live-response"]')?.getBoundingClientRect()
            .height ?? 0,
      });
    };
    const recordMutations = (records: MutationRecord[]) => {
      // Record removed subtrees as well as current presence: a chip can be
      // removed and restored between animation frames (or in one delivery).
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (
            removed instanceof Element &&
            (removed.matches(chipSelector) || removed.querySelector(chipSelector))
          ) {
            probe.removedChips += 1;
          }
        }
      }
      sample('mutation');
    };
    const mutations = new MutationObserver(recordMutations);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    const resizes = new ResizeObserver(() => sample('resize'));
    resizes.observe(viewport);
    const frame = () => {
      sample('frame');
      frameId = requestAnimationFrame(frame);
    };
    sample('initial');
    frameId = requestAnimationFrame(frame);
  });

  let result: { samples: Sample[]; removedChips: number } | undefined;
  try {
    for (let step = 1; step <= 12; step += 1) {
      await host.evaluate((node, currentStep) => {
        (node as SampledHost).pendingProposalProbe!.step = currentStep;
      }, step);
      await host.update({ props: { width: 560, liveMessages: messages(step), pendingProposals } });
      // Wait for actual text delivery, including the Markdown viewer's trailing throttle.
      await expect(live).toContainText(`Stream segment ${step}.`);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
  } finally {
    result = await host.evaluate((node) => {
      const probe = (node as SampledHost).pendingProposalProbe!;
      probe.stop();
      return { samples: probe.samples, removedChips: probe.removedChips };
    });
    await testInfo.attach('pending-proposal-streaming-observations', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
  }

  await testInfo.attach('pending-proposal-streaming-bottom', {
    body: await host.screenshot(),
    contentType: 'image/png',
  });
  const { samples, removedChips } = result;
  const frames = samples.filter((sample) => sample.source === 'frame');
  expect(new Set(frames.map((sample) => sample.step)).size).toBeGreaterThanOrEqual(12);
  expect(samples.at(-1)!.tailHeight).toBeGreaterThan(samples[0].tailHeight);
  expect.soft(removedChips, 'the chip must never be removed during text updates').toBe(0);
  expect.soft(samples.every((sample) => sample.chipPresent)).toBe(true);
  expect
    .soft(
      Math.max(
        ...samples.map((sample) => Math.abs(sample.viewportHeight - samples[0].viewportHeight)),
      ),
    )
    .toBeLessThanOrEqual(2);
  // Mutation callbacks may precede followBottom's correction; painted frames must stay pinned.
  expect(Math.max(...frames.map((sample) => Math.abs(sample.distance)))).toBeLessThanOrEqual(2);
});

test('scrolls to the pending proposal and restores the chip when returning to live output', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 960, height: 1000 });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { width: 560, liveMessages: messages(0), pendingProposals },
  });
  const scroll = host.getByTestId('chat-transcript-scroll-viewport');
  const chip = host.getByTestId('pending-proposal-chip');
  const card = host.locator('[data-apply-tool-call-id="pending-streaming-proposal"]');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(card).toBeInViewport();
  await expect(chip).toHaveCount(0);

  await host.getByRole('button', { name: 'Scroll to bottom', exact: true }).click();
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);
  await expect(chip).toBeVisible();

  // A native scroll gesture must also hide the chip when its proposal enters view.
  await scroll.hover();
  await page.mouse.wheel(0, -(await scroll.evaluate((node) => node.scrollHeight)));
  await expect(card).toBeInViewport();
  await expect(chip).toHaveCount(0);
});
