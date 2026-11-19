import type { Locator, MountResult, TestInfo } from '@playwright/experimental-ct-svelte';
import type { AgentMessage, ContentBlock } from '$shared/types';
import {
  expect,
  expectMotionToSettle,
  motionSnapshot,
  test,
  wheelUntilScrolled,
} from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

// The live preview of a collapsed tool run is a short scroll region that keeps
// the newest call in view while the agent streams.

test.setTimeout(120_000);

const steps = [
  'Load the workspace tools',
  'Read the workspace details, spec and siblings',
  'List notes in the related sibling workspaces',
  'Read prior integration notes from sibling workspaces',
  'Search the codebase for webhook primitives',
  'Summarize the integration options',
  'Draft the integration plan',
];

/** Enough earlier turns to make the chat itself scroll. */
const history: AgentMessage[] = Array.from({ length: 12 }, (_, index) => ({
  id: `history-${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  timestamp: '2026-11-19T11:00:00.000Z',
  contentBlocks: [{ type: 'text', text: `Earlier message ${index}. ${'Context. '.repeat(30)}` }],
})) as AgentMessage[];

/** A streaming turn whose newest tool call is still running. */
function transcript(tools: number, earlier: AgentMessage[] = []): AgentMessage[] {
  const content: ContentBlock[] = [];
  for (let index = 0; index < tools; index += 1) {
    content.push({
      type: 'tool_use',
      id: `tool-${index}`,
      toolCallId: `call-${index}`,
      name: 'launch-process',
      input: { command: `echo ${index}`, description: steps[index] },
    } as ContentBlock);
    if (index < tools - 1)
      content.push({
        type: 'tool_result',
        id: `result-${index}`,
        tool_use_id: `call-${index}`,
        output: 'ok',
      } as ContentBlock);
  }
  return [
    ...earlier,
    {
      id: 'user-prompt',
      role: 'user',
      timestamp: '2026-11-19T12:00:00.000Z',
      contentBlocks: [{ type: 'text', text: 'How can we integrate with Slack?' }],
    } as AgentMessage,
    {
      id: 'live-response',
      role: 'assistant',
      timestamp: '2026-11-19T12:00:01.000Z',
      isStreaming: true,
      streamingComplete: false,
      contentBlocks: content,
    } as AgentMessage,
  ];
}

type Host = MountResult<typeof ChatPanelOperationalGeometryHost>;

const props = (tools: number, earlier: AgentMessage[] = []) => ({
  width: 760,
  height: 640,
  collapseToolRuns: true,
  liveStreaming: true,
  liveMessages: transcript(tools, earlier),
});

function previewOf(host: Locator) {
  return host.locator('[data-message-id="live-response"] .cylinder-scroller');
}

async function readPreview(preview: Locator) {
  return preview.evaluate((node) => {
    const rows = node.querySelectorAll('[data-tool-entry]');
    const newest = rows[rows.length - 1]?.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
      rows: rows.length,
      scrollTop: node.scrollTop,
      newestInView:
        !!newest &&
        newest.height > 0 &&
        newest.top >= box.top - 1 &&
        newest.bottom <= box.bottom + 1,
    };
  });
}

/** Add one tool call and wait until the preview, including a deferred follow, is still. */
async function addToolCall(host: Host, tools: number) {
  const preview = previewOf(host);
  const before = await motionSnapshot(preview);
  await host.update({ props: props(tools) });
  await expect(preview.locator('[data-tool-entry]')).toHaveCount(tools);
  // Longer than the preview's 150 ms scroll-activity window, so a follow it
  // deferred has started before stillness counts.
  await expectMotionToSettle(preview, { changedFrom: before, quietMs: 400 });
  return readPreview(preview);
}

async function attachShot(host: Locator, name: string, testInfo: TestInfo) {
  await testInfo.attach(name, {
    body: await host.screenshot({ path: testInfo.outputPath(`${name}.png`) }),
    contentType: 'image/png',
  });
}

test('keeps the newest tool call in view as calls stream in', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const host = await mount(ChatPanelOperationalGeometryHost, { props: props(2) });
  await expect(previewOf(host)).toBeVisible();
  for (let tools = 3; tools <= steps.length; tools += 1) {
    expect(await addToolCall(host, tools), `after tool call ${tools}`).toMatchObject({
      newestInView: true,
    });
  }
  await attachShot(host, 'streamed-calls', testInfo);
});

test('keeps following after an upward wheel the preview cannot scroll', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const host = await mount(ChatPanelOperationalGeometryHost, { props: props(2) });
  const preview = previewOf(host);
  await expect(preview).toBeVisible();
  // Two calls fit, so the preview has nothing to scroll and the gesture passes on.
  expect(await preview.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  await preview.evaluate((node) => {
    node.dataset.wheels = '0';
    node.addEventListener(
      'wheel',
      () => (node.dataset.wheels = String(Number(node.dataset.wheels) + 1)),
      { capture: true, passive: true },
    );
  });
  await preview.hover();
  await expect
    .poll(async () => {
      // eslint-disable-next-line intent/no-raw-mouse-wheel-in-ct -- the preview cannot scroll; this wheel must reach it without moving it
      await page.mouse.wheel(0, -120);
      return Number(await preview.getAttribute('data-wheels'));
    })
    .toBeGreaterThan(0);
  expect(await preview.evaluate((node) => node.scrollTop)).toBe(0);

  for (let tools = 3; tools <= steps.length; tools += 1) {
    expect(await addToolCall(host, tools), `after tool call ${tools}`).toMatchObject({
      newestInView: true,
    });
  }
  await attachShot(host, 'wheel-then-stream', testInfo);
});

test('holds a reader who scrolled the preview back, then resumes at the bottom', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const host = await mount(ChatPanelOperationalGeometryHost, { props: props(4) });
  const preview = previewOf(host);
  await expect(preview).toBeVisible();
  await expect.poll(async () => (await readPreview(preview)).newestInView).toBe(true);

  await wheelUntilScrolled(preview, { deltaY: -60 });
  await expectMotionToSettle(preview, { quietMs: 400 });
  const reading = await readPreview(preview);
  expect(reading.newestInView).toBe(false);

  const held = await addToolCall(host, 5);
  expect(held.scrollTop).toBeCloseTo(reading.scrollTop, 0);
  expect(held.newestInView).toBe(false);
  await attachShot(host, 'reader-held', testInfo);

  await wheelUntilScrolled(preview, { deltaY: 10_000, pointer: 'current' });
  await expect.poll(async () => (await readPreview(preview)).newestInView).toBe(true);
  expect(await addToolCall(host, 6)).toMatchObject({ newestInView: true });
  await attachShot(host, 'reader-resumed', testInfo);
});

test('keeps the newest tool call in view when the chat scrolls under it', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const host = await mount(ChatPanelOperationalGeometryHost, { props: props(5, history) });
  const preview = previewOf(host);
  const chat = host.getByTestId('chat-transcript-scroll-viewport');
  await expect(preview).toBeVisible();
  await expect.poll(async () => (await readPreview(preview)).newestInView).toBe(true);

  // Make room below, then move the chat on its own, as it does when it
  // follows new content. The preview moves on screen but must not scroll.
  await wheelUntilScrolled(chat, {
    deltaY: -120,
    pointer: host.getByText('How can we integrate with Slack?'),
  });
  await expectMotionToSettle(preview, { quietMs: 400 });
  const following = await readPreview(preview);
  expect(following.newestInView).toBe(true);
  const before = await motionSnapshot(preview);
  await chat.evaluate((node) => {
    node.scrollTop += 40;
  });
  await expectMotionToSettle(preview, { changedFrom: before, quietMs: 400 });
  const moved = await readPreview(preview);
  expect(moved.scrollTop).toBeCloseTo(following.scrollTop, 0);
  expect(moved.newestInView).toBe(true);
  await attachShot(host, 'chat-scrolled', testInfo);
});
