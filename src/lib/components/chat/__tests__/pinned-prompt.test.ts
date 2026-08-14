/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { attachPinnedPromptMessage, createPinnedPromptController } from '../pinned-prompt';

function message(id: string): AgentMessage {
  return { id, role: 'user', contentBlocks: [{ type: 'text', text: id }] } as AgentMessage;
}

describe('pinned prompt controller', () => {
  it('selects an independent source row without moving or resizing it', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const source = document.createElement('div');
    source.dataset.pinnableUserPrompt = '';
    source.dataset.pinnedPromptId = 'prompt-1';
    source.getBoundingClientRect = () => ({ top: 90, height: 42 }) as DOMRect;
    attachPinnedPromptMessage(source, message('prompt-1'));
    container.append(source);
    const before = source.getBoundingClientRect();

    expect(createPinnedPromptController().update(container, true)?.id).toBe('prompt-1');
    expect(source.parentElement).toBe(container);
    expect(source.getBoundingClientRect()).toEqual(before);
  });

  it('disables without retaining an owned source row', () => {
    const container = document.createElement('div');
    expect(createPinnedPromptController().update(container, false)).toBeNull();
  });
});
