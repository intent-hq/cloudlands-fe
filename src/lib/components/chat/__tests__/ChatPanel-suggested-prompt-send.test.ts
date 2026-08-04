import { describe, it, expect, vi } from 'vitest';

import type { DraftsClient } from '$lib/client/app-client';
import type { ContextItem } from '../input/context-api';

/**
 * Regression tests for the suggested-prompt send path (ChatPanel.svelte).
 *
 * Selecting a suggested prompt (SuggestedPrompts click, Ctrl/Alt+number
 * shortcut, or ChiefChatEmptyState selection) must send the prompt BARE and
 * leave the composer draft fully intact: no composer context items or
 * workspace context folded into the payload, no input clearing, and no
 * backend draft clear. The normal composer send keeps clearing everything.
 *
 * Mirrors the extracted-logic pattern used by ChatPanel-draft-attachments
 * .test.ts: the payload builders and `performLocalSendCleanup` body are
 * reproduced here so the exact behavior of both paths is asserted.
 */

// Mirrors handleSelectSuggestedPrompt's sendMessage payload in ChatPanel.svelte.
function buildSuggestedPromptPayload(env: {
  wsId: string;
  prompt: string;
  agentName?: string;
  agentModel?: string;
  isInitialWorkspaceAgent?: boolean;
}) {
  return {
    wsId: env.wsId,
    text: env.prompt,
    agentName: env.agentName,
    agentModel: env.agentModel,
    isInitialWorkspaceAgent: env.isInitialWorkspaceAgent,
  };
}

// Mirrors handleSend's sendMessage payload assembly in ChatPanel.svelte.
function buildComposerSendPayload(env: {
  wsId: string;
  text: string;
  contextItems: ContextItem[];
  inlineImageItems: ContextItem[];
  mentionContextItems: ContextItem[];
  workspaceContextStr: string;
}) {
  const allContextItems = [
    ...env.contextItems,
    ...env.inlineImageItems,
    ...env.mentionContextItems,
  ];
  const imageBlocks = allContextItems
    .filter((item) => item.imageData && item.imageMimeType)
    .map((item) => ({
      type: 'image' as const,
      data: item.imageData!,
      mimeType: item.imageMimeType!,
    }));
  return {
    wsId: env.wsId,
    text: env.text,
    contextItems: allContextItems,
    workspaceContextStr: env.workspaceContextStr,
    ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
  };
}

interface ComposerState {
  inputValue: string;
  contextItems: ContextItem[];
}

// Mirrors ChatPanel.svelte's performLocalSendCleanup body.
async function performLocalSendCleanup(
  options: { clearInput?: boolean; followBottom?: boolean; historyText?: string | null },
  deps: {
    state: ComposerState;
    inputComponent: { clear: () => void };
    drafts: DraftsClient;
    workspaceId: string;
    agentId: string;
    addToInputHistory: (text: string) => void;
  },
) {
  if (options.historyText) {
    deps.addToInputHistory(options.historyText);
  }
  if (options.clearInput) {
    deps.state.contextItems = [];
    deps.state.inputValue = '';
    deps.inputComponent.clear();
    await deps.drafts.clear(deps.workspaceId, deps.agentId);
  }
}

function createDeps(state: ComposerState) {
  const drafts: DraftsClient = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue({ ok: true, updatedAt: '2026-08-04T00:00:00Z' }),
    clear: vi.fn().mockResolvedValue({ ok: true }),
  };
  return {
    state,
    inputComponent: { clear: vi.fn() },
    drafts,
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    addToInputHistory: vi.fn(),
  };
}

const imageItem: ContextItem = {
  id: 'file-upload-1-cat.png',
  type: 'file',
  label: 'cat.png',
  imageData: 'aGVsbG8=',
  imageMimeType: 'image/png',
};

describe('suggested-prompt send payload', () => {
  it('sends the prompt bare — no context items, workspace context, or imageBlocks', () => {
    const payload = buildSuggestedPromptPayload({
      wsId: 'ws-1',
      prompt: 'Review the failing tests',
      agentName: 'Chief',
      agentModel: 'model-x',
      isInitialWorkspaceAgent: false,
    });

    expect(payload.text).toBe('Review the failing tests');
    expect(payload).not.toHaveProperty('contextItems');
    expect(payload).not.toHaveProperty('workspaceContextStr');
    expect(payload).not.toHaveProperty('imageBlocks');
    expect(payload).not.toHaveProperty('noteIds');
  });

  it('normal composer send still folds context items and workspace context into the payload', () => {
    const payload = buildComposerSendPayload({
      wsId: 'ws-1',
      text: 'hello',
      contextItems: [imageItem],
      inlineImageItems: [],
      mentionContextItems: [],
      workspaceContextStr: 'workspace ctx',
    });

    expect(payload.contextItems).toEqual([imageItem]);
    expect(payload.workspaceContextStr).toBe('workspace ctx');
    expect(payload.imageBlocks).toEqual([
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });
});

describe('suggested-prompt send cleanup leaves the draft intact', () => {
  it('retains draft text + attachments and never clears the backend draft', async () => {
    const state: ComposerState = { inputValue: 'my draft', contextItems: [imageItem] };
    const deps = createDeps(state);

    // Mirrors handleSelectSuggestedPrompt: performLocalSendCleanup({ followBottom: true })
    await performLocalSendCleanup({ followBottom: true }, deps);

    expect(state.inputValue).toBe('my draft');
    expect(state.contextItems).toEqual([imageItem]);
    expect(deps.inputComponent.clear).not.toHaveBeenCalled();
    expect(deps.drafts.clear).not.toHaveBeenCalled();
    expect(deps.addToInputHistory).not.toHaveBeenCalled();
  });

  it('normal composer send still clears input, attachments, and the backend draft', async () => {
    const state: ComposerState = { inputValue: 'hello', contextItems: [imageItem] };
    const deps = createDeps(state);

    // Mirrors handleSend: performLocalSendCleanup({ clearInput: true, followBottom: true, historyText })
    await performLocalSendCleanup(
      { clearInput: true, followBottom: true, historyText: 'hello' },
      deps,
    );

    expect(state.inputValue).toBe('');
    expect(state.contextItems).toEqual([]);
    expect(deps.inputComponent.clear).toHaveBeenCalledOnce();
    expect(deps.drafts.clear).toHaveBeenCalledOnce();
    expect(deps.drafts.clear).toHaveBeenCalledWith('ws-1', 'agent-1');
    expect(deps.addToInputHistory).toHaveBeenCalledWith('hello');
  });
});
