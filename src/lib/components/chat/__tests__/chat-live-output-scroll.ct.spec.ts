import type { AgentMessage, ContentBlock } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

interface Frame {
  top: number;
  height: number;
  distance: number;
  tailHeight: number;
}

type SampledRoot = HTMLElement & { frames?: Frame[]; sampling?: boolean };

const history: AgentMessage[] = Array.from({ length: 40 }, (_, index) => ({
  id: `history-${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  timestamp: '2026-09-23T12:00:00.000Z',
  contentBlocks: [
    { type: 'text', text: `Historical message ${index}. ${'Earlier context. '.repeat(24)}` },
  ],
})) as AgentMessage[];

function messages(step: number): AgentMessage[] {
  const content: ContentBlock[] = [
    {
      type: 'text',
      id: 'live-text',
      text: 'Live response. ' + 'More streamed output. '.repeat(1 + step * 4),
    },
  ];
  for (let index = 0; index < Math.floor(step / 4); index += 1) {
    content.push(
      {
        type: 'tool_use',
        id: `tool-${index}`,
        toolCallId: `call-${index}`,
        name: 'view',
        input: { path: `src/example-${index}.ts` },
      },
      {
        type: 'tool_result',
        id: `result-${index}`,
        tool_use_id: `call-${index}`,
        output: 'Read complete.',
      },
    );
  }
  return [
    ...history,
    {
      id: 'live-response',
      role: 'assistant',
      timestamp: '2026-09-23T12:01:00.000Z',
      contentBlocks: content,
    } as AgentMessage,
  ];
}

for (const following of [true, false]) {
  test(`keeps live output stable while ${following ? 'following the bottom' : 'reading history'}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 960, height: 1000 });
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { width: 560, liveMessages: messages(0) },
    });
    const scroll = host.getByTestId('chat-transcript-scroll-viewport');
    const live = host.locator('[data-message-id="live-response"]');
    await expect(live).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThanOrEqual(2);
    if (!following) {
      await scroll.evaluate((node) => {
        node.dispatchEvent(new WheelEvent('wheel', { deltaY: -250 }));
        node.scrollTop -= 250;
        node.dispatchEvent(new Event('scroll'));
      });
      await expect
        .poll(() =>
          scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
        )
        .toBeGreaterThan(200);
    }
    await scroll.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await scroll.evaluate((node) => {
      const root = node as SampledRoot;
      root.frames = [];
      root.sampling = true;
      const sample = () => {
        const tail = root.querySelector('[data-message-id="live-response"]');
        root.frames!.push({
          top: root.scrollTop,
          height: root.scrollHeight,
          distance: root.scrollHeight - root.clientHeight - root.scrollTop,
          tailHeight: tail?.getBoundingClientRect().height ?? 0,
        });
        if (root.sampling) requestAnimationFrame(sample);
      };
      sample();
    });
    for (let step = 1; step <= 24; step += 1) {
      await host.update({ props: { width: 560, liveMessages: messages(step) } });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
    await expect(live.locator('[data-tool-use-id]')).toHaveCount(6);
    const frames = await scroll.evaluate((node) => {
      const root = node as SampledRoot;
      root.sampling = false;
      return root.frames!;
    });
    await testInfo.attach('live-output-scroll-frames', {
      body: JSON.stringify(frames),
      contentType: 'application/json',
    });
    expect(frames.length).toBeGreaterThan(24);
    expect(frames.at(-1)!.tailHeight).toBeGreaterThan(frames[0].tailHeight);
    const heightDrops = frames.slice(1).map((frame, i) => frames[i].tailHeight - frame.tailHeight);
    expect(Math.max(...heightDrops)).toBeLessThanOrEqual(2);
    if (following) {
      expect(Math.max(...frames.map((frame) => Math.abs(frame.distance)))).toBeLessThanOrEqual(2);
    } else {
      expect(
        Math.max(...frames.map((frame) => Math.abs(frame.top - frames[0].top))),
      ).toBeLessThanOrEqual(2);
    }
  });
}

for (const codeBlock of [false, true]) {
  test(`keeps streamed ${codeBlock ? 'code lines' : 'prose line breaks'} from bouncing`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 960, height: 1000 });
    let text = codeBlock ? '```typescript\nconst value0 = 0;' : 'Streaming line 0.';
    const liveMessages = (): AgentMessage[] => [
      ...history,
      {
        id: 'live-response',
        role: 'assistant',
        timestamp: '2026-09-23T12:01:00.000Z',
        isStreaming: true,
        streamingComplete: false,
        contentBlocks: [{ type: 'text', id: 'live-text', text }],
      } as AgentMessage,
    ];
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { width: 560, liveMessages: liveMessages() },
    });
    const scroll = host.getByTestId('chat-transcript-scroll-viewport');
    const live = host.locator('[data-message-id="live-response"]');
    await expect(live).toContainText(codeBlock ? 'value0' : 'Streaming line 0');
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThanOrEqual(2);
    await scroll.evaluate((node) => {
      const root = node as SampledRoot;
      root.frames = [];
      root.sampling = true;
      const sample = () => {
        const tail = root.querySelector('[data-message-id="live-response"]');
        root.frames!.push({
          top: root.scrollTop,
          height: root.scrollHeight,
          distance: root.scrollHeight - root.clientHeight - root.scrollTop,
          tailHeight: tail?.getBoundingClientRect().height ?? 0,
        });
        if (root.sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (let line = 1; line <= 12; line += 1) {
      for (const chunk of [
        '\n',
        codeBlock ? `const value${line} = ${line};` : `Streaming line ${line}.`,
      ]) {
        text += chunk;
        await host.update({ props: { width: 560, liveMessages: liveMessages() } });
        // Publish each boundary through the viewer's trailing streaming throttle.
        await page.waitForTimeout(200);
      }
      await expect(live).toContainText(codeBlock ? `value${line}` : `Streaming line ${line}`);
    }
    const frames = await scroll.evaluate((node) => {
      const root = node as SampledRoot;
      root.sampling = false;
      return root.frames!;
    });
    await testInfo.attach('line-boundary-scroll-frames', {
      body: JSON.stringify(frames),
      contentType: 'application/json',
    });
    expect(frames.length).toBeGreaterThan(24);
    expect(frames.at(-1)!.tailHeight).toBeGreaterThan(frames[0].tailHeight);
    const heightDrops = frames.slice(1).map((frame, i) => frames[i].tailHeight - frame.tailHeight);
    expect(Math.max(...heightDrops)).toBeLessThanOrEqual(2);
    expect(Math.max(...frames.map((frame) => Math.abs(frame.distance)))).toBeLessThanOrEqual(2);
  });
}
