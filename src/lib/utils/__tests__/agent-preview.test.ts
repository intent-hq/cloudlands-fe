/**
 * Unit tests for the extracted AgentCard preview derivation: the precedence
 * chain (attention → live text → live tool → user line → digest/report →
 * lastResponse/lastToolUse/lastUserMsg) must match the previous template
 * `{#if}/{:else if}` chain exactly.
 */
import { describe, expect, it } from 'vitest';

import type { ToolUseBlock } from '$shared/types';
import { deriveAgentCardPreview, type AgentCardPreviewInputs } from '../agent-preview';

const toolUse = (name: string): ToolUseBlock =>
  ({ type: 'tool_use', id: `tool-${name}`, name, input: {} }) as ToolUseBlock;

function inputs(overrides: Partial<AgentCardPreviewInputs> = {}): AgentCardPreviewInputs {
  return {
    attentionRequest: null,
    liveResponseLine: '',
    liveToolUse: undefined,
    hasRenderableLiveTool: false,
    showUserMessagePreview: false,
    userFirstLine: '',
    effectiveCompletionReport: undefined,
    lastResponse: '',
    lastToolUse: undefined,
    lastUserMsg: '',
    ...overrides,
  };
}

/** Every slot populated — used to prove each precedence level wins in turn. */
function allPopulated(): AgentCardPreviewInputs {
  return inputs({
    attentionRequest: { kind: 'blocker', reason: 'sandbox broken' },
    liveResponseLine: 'live line',
    liveToolUse: toolUse('read_file'),
    hasRenderableLiveTool: true,
    showUserMessagePreview: true,
    userFirstLine: 'user line',
    effectiveCompletionReport: 'the report',
    lastResponse: 'persisted response',
    lastToolUse: toolUse('view'),
    lastUserMsg: 'persisted user msg',
  });
}

describe('deriveAgentCardPreview precedence', () => {
  it('returns null when no source has content', () => {
    expect(deriveAgentCardPreview(inputs())).toBeNull();
  });

  it('attention request outranks everything', () => {
    const preview = deriveAgentCardPreview(allPopulated());
    expect(preview).toEqual({
      kind: 'attention',
      attention: { kind: 'blocker', reason: 'sandbox broken' },
    });
  });

  it('live streamed text outranks the live tool label', () => {
    const preview = deriveAgentCardPreview({ ...allPopulated(), attentionRequest: null });
    expect(preview).toEqual({ kind: 'live-text', text: 'live line' });
  });

  it('renderable live tool outranks the user line', () => {
    const preview = deriveAgentCardPreview({
      ...allPopulated(),
      attentionRequest: null,
      liveResponseLine: '',
    });
    expect(preview).toEqual({ kind: 'live-tool', toolUse: toolUse('read_file') });
  });

  it('hidden live tool falls through to the user line', () => {
    const preview = deriveAgentCardPreview({
      ...allPopulated(),
      attentionRequest: null,
      liveResponseLine: '',
      hasRenderableLiveTool: false,
    });
    expect(preview).toEqual({ kind: 'user', text: 'user line' });
  });

  it('user line outranks the digest/report', () => {
    const preview = deriveAgentCardPreview(
      inputs({
        showUserMessagePreview: true,
        userFirstLine: 'user line',
        effectiveCompletionReport: 'the report',
        lastResponse: 'persisted response',
      }),
    );
    expect(preview).toEqual({ kind: 'user', text: 'user line' });
  });

  it('digest/report outranks the persisted transcript fallbacks', () => {
    const preview = deriveAgentCardPreview({
      ...allPopulated(),
      attentionRequest: null,
      liveResponseLine: '',
      hasRenderableLiveTool: false,
      showUserMessagePreview: false,
    });
    expect(preview).toEqual({ kind: 'report', text: 'the report' });
  });

  it('lastResponse outranks lastToolUse and lastUserMsg in the fallback block', () => {
    const preview = deriveAgentCardPreview(
      inputs({
        lastResponse: 'persisted response',
        lastToolUse: toolUse('view'),
        lastUserMsg: 'persisted user msg',
      }),
    );
    expect(preview).toEqual({ kind: 'last-response', text: 'persisted response' });
  });

  it('lastToolUse outranks lastUserMsg when there is no lastResponse', () => {
    const preview = deriveAgentCardPreview(
      inputs({ lastToolUse: toolUse('view'), lastUserMsg: 'persisted user msg' }),
    );
    expect(preview).toEqual({ kind: 'last-tool', toolUse: toolUse('view') });
  });

  it('falls back to lastUserMsg alone', () => {
    const preview = deriveAgentCardPreview(inputs({ lastUserMsg: 'persisted user msg' }));
    expect(preview).toEqual({ kind: 'last-user', text: 'persisted user msg' });
  });

  it('ignores a user line when showUserMessagePreview is false', () => {
    const preview = deriveAgentCardPreview(
      inputs({ userFirstLine: 'user line', lastUserMsg: 'persisted user msg' }),
    );
    expect(preview).toEqual({ kind: 'last-user', text: 'persisted user msg' });
  });
});
