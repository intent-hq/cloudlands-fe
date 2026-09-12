/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolUseBlock } from '$shared/types';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$lib/utils/tool-classifier', async () => {
  const { faWrench } = await import('@fortawesome/free-solid-svg-icons');
  return {
    classifyTool: (name: string) => ({
      category:
        name === 'read_note'
          ? 'note'
          : name.includes('set_workspace_title')
            ? 'workspace'
            : 'terminal',
      verb:
        name === 'read_note'
          ? 'Read note'
          : name.includes('set_workspace_title')
            ? 'Rename workspace'
            : 'Run',
      subject: 'an exceptionally long tool summary '.repeat(10),
      noteId: name === 'read_note' ? 'spec' : null,
      icon: faWrench,
    }),
    isContextEngineTool: () => false,
  };
});

vi.mock('../tool-result-parser', () => ({
  parseToolResult: (name: string, _input: unknown, result: unknown) =>
    name === 'codebase-retrieval'
      ? { type: 'unknown', content: typeof result === 'string' ? result : '' }
      : { type: 'unknown' },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('../ToolDetails.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/editor/CodeBlock.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ContextEngineToolCall from '../ContextEngineToolCall.svelte';
import { streamingPulse } from '../streaming-pulse';
import ToolCall from '../ToolCall.svelte';

const genericTool = {
  type: 'tool_use',
  id: 'generic-running',
  name: 'launch-process',
  input: { command: 'pnpm test' },
} as ToolUseBlock;
const contextTool = {
  type: 'tool_use',
  id: 'context-running',
  name: 'codebase-retrieval',
  input: { information_request: 'Find every active tool row' },
} as ToolUseBlock;

afterEach(cleanup);

function expectRunningIdentityOnly(container: HTMLElement) {
  const leading = container.querySelector('[data-tool-icon]');
  expect(leading).toBeTruthy();
  expect(leading?.hasAttribute('data-streaming-pulse')).toBe(true);
  expect(leading?.className).not.toContain('animate-pulse');
  expect(container.querySelector('[data-operational-trailing]')).toBeNull();
  expect(container.querySelector('[data-testid="tool-call-status"]')).toBeNull();
  expect(container.querySelector('[data-icon="spinner"]')).toBeNull();
}

describe('tool-call running status presentation', () => {
  it('uses only the leading pulse for generic and context-engine running rows', () => {
    const generic = render(ToolCall, { props: { toolUse: genericTool, toolState: 'running' } });
    expectRunningIdentityOnly(generic.container);
    cleanup();

    const context = render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'running' },
    });
    expectRunningIdentityOnly(context.container);
  });

  it('preserves generic and context-engine success and error status icons', () => {
    const successTool = {
      ...genericTool,
      id: 'generic-success',
      name: 'set_workspace_title_workspace-mcp',
    };
    render(ToolCall, {
      props: { toolUse: successTool, toolState: 'completed', result: { ok: true } },
    });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('success');
    cleanup();

    render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'error', result: 'failed' },
    });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('error');
    cleanup();

    render(ContextEngineToolCall, { props: { toolUse: contextTool, toolState: 'completed' } });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('success');
    cleanup();

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'error', result: 'failed' },
    });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('error');
  });

  it('preserves real trailing actions and keyboard disclosure behavior', async () => {
    const noteTool = { ...genericTool, id: 'note-action', name: 'read_note' };
    const note = render(ToolCall, { props: { toolUse: noteTool, toolState: 'completed' } });
    expect(screen.getByTestId('tool-call-note-link')).toBeTruthy();
    expect(note.container.querySelector('[data-operational-trailing]')).toBeTruthy();
    cleanup();

    render(ToolCall, { props: { toolUse: genericTool, toolState: 'running' } });
    const disclosure = screen.getByTestId('tool-call-disclosure');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('#tool-details-generic-running')).toBeTruthy();
  });
});

describe('streaming pulse under prefers-reduced-motion', () => {
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let nowMs = 0;
  let reducedMotion = false;
  let mediaChange: (() => void) | undefined;
  const mediaListeners = { add: vi.fn(), remove: vi.fn() };

  function advanceFrames(count: number): void {
    for (let frame = 0; frame < count; frame += 1) {
      nowMs += 1000 / 60;
      const due = [...frameCallbacks.values()];
      frameCallbacks.clear();
      due.forEach((callback) => callback(nowMs));
    }
  }

  function countOpacityWrites(node: HTMLElement, frames: number): number {
    const setter = vi.spyOn(node.style, 'opacity', 'set');
    advanceFrames(frames);
    const writes = setter.mock.calls.length;
    setter.mockRestore();
    return writes;
  }

  beforeEach(() => {
    frameCallbacks.clear();
    frameId = 0;
    nowMs += 10_007;
    reducedMotion = false;
    mediaChange = undefined;
    mediaListeners.add.mockClear();
    mediaListeners.remove.mockClear();
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameId += 1;
        frameCallbacks.set(frameId, callback);
        return frameId;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frameCallbacks.delete(id)),
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        get matches() {
          return reducedMotion;
        },
        addEventListener: (_event: string, callback: () => void) => {
          mediaListeners.add(callback);
          mediaChange = callback;
        },
        removeEventListener: mediaListeners.remove,
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drives the icon opacity from the frame clock when motion is allowed', () => {
    const node = document.createElement('span');
    const action = streamingPulse(node, true)!;
    expect(node.hasAttribute('data-streaming-pulse')).toBe(true);
    expect(node.style.opacity).not.toBe('');
    expect(countOpacityWrites(node, 60)).toBeGreaterThan(5);
    action.destroy!();
    expect(node.style.opacity).toBe('');
    expect(node.hasAttribute('data-streaming-pulse')).toBe(false);
    expect(frameCallbacks.size).toBe(0);
    expect(countOpacityWrites(node, 60)).toBe(0);
    expect(mediaListeners.remove).toHaveBeenCalledWith(
      'change',
      mediaListeners.add.mock.calls[0][0],
    );
  });

  it('holds normal opacity with zero writes while reduced motion is preferred', () => {
    reducedMotion = true;
    const node = document.createElement('span');
    const action = streamingPulse(node, true)!;
    expect(node.hasAttribute('data-streaming-pulse')).toBe(true);
    expect(node.style.opacity).toBe('');
    expect(frameCallbacks.size).toBe(0);
    expect(countOpacityWrites(node, 60)).toBe(0);

    reducedMotion = false;
    mediaChange!();
    expect(node.style.opacity).not.toBe('');
    expect(countOpacityWrites(node, 60)).toBeGreaterThan(5);

    reducedMotion = true;
    mediaChange!();
    expect(node.style.opacity).toBe('');
    expect(frameCallbacks.size).toBe(0);
    expect(countOpacityWrites(node, 60)).toBe(0);

    action.destroy!();
    expect(node.hasAttribute('data-streaming-pulse')).toBe(false);
    reducedMotion = false;
    mediaChange!();
    expect(node.style.opacity).toBe('');
    expect(frameCallbacks.size).toBe(0);
  });
});
