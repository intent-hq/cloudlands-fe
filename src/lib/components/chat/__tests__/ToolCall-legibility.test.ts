/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.hoisted(() => vi.fn());
const parseToolResultMock = vi.hoisted(() => vi.fn((): any => ({ type: 'unknown' })));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: dispatchMock });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => undefined },
}));

vi.mock('$lib/utils/tool-classifier', async () => {
  const { faWrench } = await import('@fortawesome/free-solid-svg-icons');
  return {
    classifyTool: () => ({
      verb: 'Run',
      subject: 'tests with an exceptionally long descriptive target '.repeat(8),
      icon: faWrench,
    }),
    isContextEngineTool: () => false,
  };
});

vi.mock('../tool-result-parser', () => ({
  parseToolResult: parseToolResultMock,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('../ToolDetails.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/settings/mcp/McpIcon.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/AgentAvatar.svelte')).default,
}));

import ToolCall from '../ToolCall.svelte';

afterEach(() => {
  cleanup();
  parseToolResultMock.mockReset();
  parseToolResultMock.mockReturnValue({ type: 'unknown' });
});

describe('ToolCall conversation legibility', () => {
  it('renders a concise action with an accessible collapsed details disclosure', async () => {
    const { container } = render(ToolCall, {
      props: {
        toolUse: { id: 'tool-1', name: 'shell', input: { command: 'pnpm test' } } as any,
        toolState: 'completed',
        result: { stdout: 'passed' },
      },
    });

    const disclosure = screen.getByRole('button', {
      name: /Run tests with an exceptionally long descriptive target/,
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure.getAttribute('aria-controls')).toBe('tool-details-tool-1');
    expect(disclosure.getAttribute('title')).toBe('Technical details');
    expect(container.textContent).not.toContain('Details');
    expect(container.querySelector('#tool-details-tool-1')).toBeNull();
    expect(container.querySelector('[data-operational-chevron]')).toBeNull();
    expect(container.querySelector('[data-operational-trailing]')).toBeNull();

    container.style.width = '120px';
    const row = container.querySelector('[data-conversation-layer="tool-activity"]')!;
    const summary = screen.getByTestId('tool-call-summary');
    expect(row.scrollWidth).toBeLessThanOrEqual(container.scrollWidth);
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('overflow-hidden');
    expect(summary.className).toContain('truncate');
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);

    await fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#tool-details-tool-1')).toBeTruthy();
    expect(container.querySelector('[data-operational-chevron]')).toBeNull();
    expect(container.querySelector('[data-conversation-layer="tool-activity"]')).toBeTruthy();
  });

  it('makes a running tool call with input expandable while it awaits a result', async () => {
    const { container } = render(ToolCall, {
      props: {
        toolUse: { id: 'tool-2', name: 'shell', input: { command: 'pnpm test\n  --run' } } as any,
        toolState: 'running',
      },
    });

    const disclosure = screen.getByRole('button', {
      name: /Run tests with an exceptionally long descriptive target/,
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#tool-details-tool-2')).toBeNull();

    await fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#tool-details-tool-2')).toBeTruthy();

    await fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#tool-details-tool-2')).toBeNull();
  });

  it('does not make a running tool call without input expandable', () => {
    render(ToolCall, {
      props: {
        toolUse: { id: 'tool-3', name: 'shell', input: {} } as any,
        toolState: 'running',
      },
    });

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ToolCall lazy block hydration (§5.5 slim → v7.2 agent.getMessageBlock)', () => {
  afterEach(() => dispatchMock.mockClear());

  it('expanding a slim-truncated row dispatches one hydration request per truncated block', async () => {
    render(ToolCall, {
      props: {
        toolUse: {
          id: 'msg-1:0',
          name: 'shell',
          input: { command: 'preview…' },
          inputTruncated: true,
          inputBytes: 900_000,
        } as any,
        toolState: 'completed',
        result: 'preview output…',
        resultBlock: {
          type: 'tool_result',
          id: 'msg-1:1',
          tool_use_id: 'call-1',
          output: 'preview output…',
          outputTruncated: true,
          outputBytes: 2_000_000,
        } as any,
        agentId: 'agent-1',
        messageId: 'msg-1',
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Run tests/ }));

    const hydrationActions = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === 'chatState/messageBlockHydrationRequested');
    expect(hydrationActions).toHaveLength(2);
    expect(hydrationActions[0].payload).toEqual(['agent-1', 'msg-1', 'msg-1:0']);
    expect(hydrationActions[1].payload).toEqual(['agent-1', 'msg-1', 'msg-1:1']);
  });

  it('expanding an under-budget row dispatches nothing (no fetch fired)', async () => {
    render(ToolCall, {
      props: {
        toolUse: { id: 'msg-2:0', name: 'shell', input: { command: 'ls' } } as any,
        toolState: 'completed',
        result: 'ok',
        resultBlock: {
          type: 'tool_result',
          id: 'msg-2:1',
          tool_use_id: 'call-2',
          output: 'ok',
        } as any,
        agentId: 'agent-1',
        messageId: 'msg-2',
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Run tests/ }));

    const hydrationActions = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === 'chatState/messageBlockHydrationRequested');
    expect(hydrationActions).toHaveLength(0);
  });

  it('without agentId/messageId a truncated row expands without dispatching', async () => {
    render(ToolCall, {
      props: {
        toolUse: {
          id: 'msg-3:0',
          name: 'shell',
          input: { command: 'preview…' },
          inputTruncated: true,
        } as any,
        toolState: 'completed',
        result: 'x',
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /Run tests/ }));

    const hydrationActions = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === 'chatState/messageBlockHydrationRequested');
    expect(hydrationActions).toHaveLength(0);
  });
});

describe('ToolCall collapsed browser screenshot preview', () => {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2kAAAAASUVORK5CYII=';
  const jpegBase64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';
  const toolUse = {
    id: 'browser-screenshot',
    name: 'workspace_api_workspace-mcp',
    input: { code: 'return ws.browser.exec([{ action: "screenshot" }])' },
  } as any;

  it('shows an accessible asset image and keeps normal expansion available', async () => {
    parseToolResultMock.mockReturnValue({
      type: 'browser',
      screenshotUrl: 'workspace-asset://workspace-1/screenshot-1',
      screenshotWidth: 1280,
      screenshotHeight: 800,
    });
    const { container } = render(ToolCall, {
      props: { toolUse, toolState: 'completed', result: { ok: true } },
    });

    const image = screen.getByRole('img', { name: 'Browser screenshot' });
    expect(image.getAttribute('src')).toBe('workspace-asset://workspace-1/screenshot-1');

    await fireEvent.click(screen.getByRole('button', { name: 'Browser screenshot' }));

    expect(screen.queryByRole('img', { name: 'Browser screenshot' })).toBeNull();
    expect(screen.getByTestId('tool-call-disclosure').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#tool-details-browser-screenshot')).toBeTruthy();
  });

  it('shows inline PNG data in the collapsed row', () => {
    parseToolResultMock.mockReturnValue({ type: 'browser', screenshotBase64: pngBase64 });

    render(ToolCall, {
      props: { toolUse, toolState: 'completed', result: { ok: true } },
    });

    expect(screen.getByRole('img', { name: 'Browser screenshot' }).getAttribute('src')).toBe(
      `data:image/png;base64,${pngBase64}`,
    );
  });

  it('shows real inline JPEG data with JPEG metadata in the collapsed row', () => {
    parseToolResultMock.mockReturnValue({ type: 'browser', screenshotBase64: jpegBase64 });

    render(ToolCall, {
      props: { toolUse, toolState: 'completed', result: { ok: true } },
    });

    expect(screen.getByRole('img', { name: 'Browser screenshot' }).getAttribute('src')).toBe(
      `data:image/jpeg;base64,${jpegBase64}`,
    );
  });

  it('does not leave invalid, failed, running, or broken images visible', async () => {
    parseToolResultMock.mockReturnValue({ type: 'browser', screenshotBase64: 'not base64 data' });
    const invalid = render(ToolCall, {
      props: { toolUse, toolState: 'completed', result: { ok: true } },
    });
    expect(screen.queryByRole('img', { name: 'Browser screenshot' })).toBeNull();
    invalid.unmount();

    parseToolResultMock.mockReturnValue({
      type: 'browser',
      screenshotUrl: 'workspace-asset://workspace-1/screenshot-2',
    });
    const running = render(ToolCall, {
      props: { toolUse, toolState: 'running', result: { ok: true } },
    });
    expect(screen.queryByRole('img', { name: 'Browser screenshot' })).toBeNull();
    running.unmount();

    const failed = render(ToolCall, {
      props: { toolUse, toolState: 'error', result: { ok: false } },
    });
    expect(screen.queryByRole('img', { name: 'Browser screenshot' })).toBeNull();
    failed.unmount();

    render(ToolCall, {
      props: { toolUse, toolState: 'completed', result: { ok: true } },
    });
    const brokenImage = screen.getByRole('img', { name: 'Browser screenshot' });
    await fireEvent.error(brokenImage);
    expect(screen.queryByRole('img', { name: 'Browser screenshot' })).toBeNull();
  });
});
