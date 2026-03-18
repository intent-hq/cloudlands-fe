import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';

// Avoid pulling heavy editor dependencies (e.g. monaco-editor) into this focused unit test.
vi.mock('$lib/components/editor/UnifiedDiffViewer.svelte', () => ({
  default: () => '' as unknown as typeof HTMLElement,
}));
vi.mock('$lib/components/editor/CodeEditor.svelte', () => ({
  default: () => '' as unknown as typeof HTMLElement,
}));

// Keep the render tree minimal (and avoid UI-library context requirements) by stubbing the chat panel.
vi.mock('$lib/components/chat/ChatPanel.svelte', () => ({
  default: () => '' as unknown as typeof HTMLElement,
}));

// Mock specialist selectors to avoid Redux store context requirement
vi.mock('$lib/store/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => readable([]),
  selectUserOverrides: () => readable({ modelOverrides: {}, behaviorPromptOverrides: {} }),
  selectOverridesLoaded: { select: () => false },
  selectEffectiveModel: { select: () => '' },
  selectSpecialistById: { select: () => null },
  selectSpecialistName: { select: () => null },
}));

// Mock the key services that ContentDrawer interacts with during agent opening.
vi.mock('$features/agent/agent.service', () => ({
  agentService: {
    getAllSessions: vi.fn(() => []),
    getSession: vi.fn((agentId: string) => ({ id: agentId, isBackground: false, metadata: {}, messages: [] })),
    restoreSession: vi.fn(async (agentId: string) => ({ id: agentId, isBackground: false, metadata: {}, messages: [] })),
    isStreaming: vi.fn(() => false),
  },
}));

vi.mock('$features/agent/services/unread-tracking.service', () => ({
  unreadTrackingService: { markAsViewed: vi.fn(), clearCurrentlyViewed: vi.fn() },
}));

import ContentDrawer from '$lib/components/layout/ContentDrawer.svelte';

describe('ContentDrawer (agent) — effect loop regression', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => void 0);
    vi.useFakeTimers();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('does not trigger an effect_update_depth_exceeded loop when opening an agent drawer', async () => {
    const { rerender } = render(ContentDrawer, {
      isOpen: true,
      contentType: 'agent',
      content: { id: 'agent-1', sessionId: 'session-1', name: 'Agent One' },
      workspace: { id: 'ws-1' } as any,
      onClose: vi.fn(),
    });

    // Allow first reactive flush and scheduled (but bounded) timers to run
    await Promise.resolve();
    vi.runOnlyPendingTimers();

    // Simulate parent re-rendering with a new content object (same identifiers)
    await rerender({
      isOpen: true,
      contentType: 'agent',
      content: { id: 'agent-1', sessionId: 'session-1', name: 'Agent One' },
      workspace: { id: 'ws-1' } as any,
    });

    await Promise.resolve();
    vi.runOnlyPendingTimers();

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('effect_update_depth_exceeded'),
    );
  });
});
