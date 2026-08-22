import { describe, it, expect } from 'vitest';
import { mapAgentPreviewToLatestContent } from './task-agent-status-preview';
import type { ToolUseBlock } from '$shared/types';

const toolUse: ToolUseBlock = {
  type: 'tool_use',
  id: 'tool-1',
  name: 'view',
  input: { path: 'a.ts' },
};

describe('mapAgentPreviewToLatestContent', () => {
  it('returns null when there is no preview', () => {
    expect(mapAgentPreviewToLatestContent(null)).toBeNull();
  });

  it('filters the attention kind to null (not rendered by TaskAgentStatus)', () => {
    expect(
      mapAgentPreviewToLatestContent({
        kind: 'attention',
        attention: { kind: 'blocker', reason: 'sandbox broken', timestamp: undefined },
        isLive: true,
      }),
    ).toBeNull();
  });

  it('renders the report kind as static text (regression: idle completionReport without digest)', () => {
    expect(
      mapAgentPreviewToLatestContent({ kind: 'report', text: 'Meta report', isLive: false }),
    ).toEqual({ text: 'Meta report', isStreaming: false });
  });

  it('regression: a hidden persisted last-tool falls through to null instead of a blank row', () => {
    const hiddenWorkspaceApi: ToolUseBlock = {
      type: 'tool_use',
      id: 'tool-2',
      name: 'workspace_api',
      input: {},
    };
    expect(
      mapAgentPreviewToLatestContent({
        kind: 'last-tool',
        toolUse: hiddenWorkspaceApi,
        isLive: false,
      }),
    ).toBeNull();

    const rawMcpName: ToolUseBlock = {
      type: 'tool_use',
      id: 'tool-3',
      name: 'mcp__some_server__do_thing',
      input: {},
    };
    expect(
      mapAgentPreviewToLatestContent({ kind: 'last-tool', toolUse: rawMcpName, isLive: true }),
    ).toBeNull();
  });

  it('maps live-text to animated text', () => {
    expect(
      mapAgentPreviewToLatestContent({ kind: 'live-text', text: 'streamed line', isLive: true }),
    ).toEqual({ text: 'streamed line', isStreaming: true });
  });

  it('maps live-tool to an animated tool block', () => {
    expect(mapAgentPreviewToLatestContent({ kind: 'live-tool', toolUse, isLive: true })).toEqual({
      toolBlock: toolUse,
      isStreaming: true,
    });
  });

  it('maps the user line to static text', () => {
    expect(
      mapAgentPreviewToLatestContent({ kind: 'user', text: 'Fix the bug', isLive: true }),
    ).toEqual({ text: 'Fix the bug', isStreaming: false });
  });

  it('maps last-response to static text', () => {
    expect(
      mapAgentPreviewToLatestContent({ kind: 'last-response', text: 'Last line', isLive: true }),
    ).toEqual({ text: 'Last line', isStreaming: false });
  });

  it('maps last-user to static text', () => {
    expect(
      mapAgentPreviewToLatestContent({ kind: 'last-user', text: 'hello there', isLive: false }),
    ).toEqual({ text: 'hello there', isStreaming: false });
  });

  it('maps last-tool to a tool block that animates only while responding', () => {
    expect(mapAgentPreviewToLatestContent({ kind: 'last-tool', toolUse, isLive: true })).toEqual({
      toolBlock: toolUse,
      isStreaming: true,
    });
    expect(mapAgentPreviewToLatestContent({ kind: 'last-tool', toolUse, isLive: false })).toEqual({
      toolBlock: toolUse,
      isStreaming: false,
    });
  });
});
