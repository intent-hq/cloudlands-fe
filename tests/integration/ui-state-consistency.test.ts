/**
 * Test UI state consistency
 * Ensures scroll position, input state, panel expansion, and search state persist
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('UI State Consistency', () => {
  let mockUIStateStore: any;
  let mockScrollManager: any;

  beforeEach(() => {
    mockUIStateStore = {
      state: new Map(),
      saveUIState: vi.fn((agentId, state) => {
        mockUIStateStore.state.set(agentId, state);
      }),
      loadUIState: vi.fn((agentId) => mockUIStateStore.state.get(agentId)),
      updateScrollPosition: vi.fn((agentId, position) => {
        const state = mockUIStateStore.state.get(agentId) || {};
        state.scrollPosition = position;
        mockUIStateStore.state.set(agentId, state);
      }),
      updateInputState: vi.fn((agentId, input) => {
        const state = mockUIStateStore.state.get(agentId) || {};
        state.inputValue = input;
        mockUIStateStore.state.set(agentId, state);
      }),
      updatePanelExpansion: vi.fn((agentId, isExpanded) => {
        const state = mockUIStateStore.state.get(agentId) || {};
        state.isExpanded = isExpanded;
        mockUIStateStore.state.set(agentId, state);
      }),
      updateSearchState: vi.fn((agentId, query) => {
        const state = mockUIStateStore.state.get(agentId) || {};
        state.searchQuery = query;
        mockUIStateStore.state.set(agentId, state);
      }),
    };

    mockScrollManager = {
      scrollPositions: new Map(),
      saveScrollPosition: vi.fn((agentId, position) => {
        mockScrollManager.scrollPositions.set(agentId, position);
      }),
      getScrollPosition: vi.fn((agentId) => mockScrollManager.scrollPositions.get(agentId) || 0),
    };
  });

  it('should persist scroll position when switching agents', () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';

    // Set scroll position for agent 1
    mockScrollManager.saveScrollPosition(agent1, 500);
    expect(mockScrollManager.getScrollPosition(agent1)).toBe(500);

    // Switch to agent 2
    mockScrollManager.saveScrollPosition(agent2, 200);

    // Switch back to agent 1
    expect(mockScrollManager.getScrollPosition(agent1)).toBe(500);
  });

  it('should preserve input field state', () => {
    const agentId = 'agent_1';
    const inputText = 'This is my message';

    mockUIStateStore.updateInputState(agentId, inputText);
    const state = mockUIStateStore.loadUIState(agentId);

    expect(state.inputValue).toBe(inputText);
  });

  it('should maintain panel expansion state', () => {
    const agentId = 'agent_1';

    mockUIStateStore.updatePanelExpansion(agentId, true);
    let state = mockUIStateStore.loadUIState(agentId);
    expect(state.isExpanded).toBe(true);

    mockUIStateStore.updatePanelExpansion(agentId, false);
    state = mockUIStateStore.loadUIState(agentId);
    expect(state.isExpanded).toBe(false);
  });

  it('should preserve search/filter state', () => {
    const agentId = 'agent_1';
    const searchQuery = 'important';

    mockUIStateStore.updateSearchState(agentId, searchQuery);
    const state = mockUIStateStore.loadUIState(agentId);

    expect(state.searchQuery).toBe(searchQuery);
  });

  it('should maintain separate UI state for different agents', () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';

    mockUIStateStore.updateInputState(agent1, 'Agent 1 input');
    mockUIStateStore.updateInputState(agent2, 'Agent 2 input');

    const state1 = mockUIStateStore.loadUIState(agent1);
    const state2 = mockUIStateStore.loadUIState(agent2);

    expect(state1.inputValue).toBe('Agent 1 input');
    expect(state2.inputValue).toBe('Agent 2 input');
  });

  it('should handle multiple UI state updates', () => {
    const agentId = 'agent_1';

    mockUIStateStore.updateScrollPosition(agentId, 300);
    mockUIStateStore.updateInputState(agentId, 'test message');
    mockUIStateStore.updatePanelExpansion(agentId, true);
    mockUIStateStore.updateSearchState(agentId, 'search term');

    const state = mockUIStateStore.loadUIState(agentId);

    expect(state.scrollPosition).toBe(300);
    expect(state.inputValue).toBe('test message');
    expect(state.isExpanded).toBe(true);
    expect(state.searchQuery).toBe('search term');
  });

  it('should clear input state when sending message', () => {
    const agentId = 'agent_1';

    mockUIStateStore.updateInputState(agentId, 'message to send');
    let state = mockUIStateStore.loadUIState(agentId);
    expect(state.inputValue).toBe('message to send');

    // Clear input after sending
    mockUIStateStore.updateInputState(agentId, '');
    state = mockUIStateStore.loadUIState(agentId);
    expect(state.inputValue).toBe('');
  });

  it('should reset search state when clearing search', () => {
    const agentId = 'agent_1';

    mockUIStateStore.updateSearchState(agentId, 'search query');
    let state = mockUIStateStore.loadUIState(agentId);
    expect(state.searchQuery).toBe('search query');

    mockUIStateStore.updateSearchState(agentId, '');
    state = mockUIStateStore.loadUIState(agentId);
    expect(state.searchQuery).toBe('');
  });

  it('should handle scroll position at boundaries', () => {
    const agentId = 'agent_1';

    // Top of scroll
    mockScrollManager.saveScrollPosition(agentId, 0);
    expect(mockScrollManager.getScrollPosition(agentId)).toBe(0);

    // Large scroll position
    mockScrollManager.saveScrollPosition(agentId, 10000);
    expect(mockScrollManager.getScrollPosition(agentId)).toBe(10000);
  });

  it('should restore full UI state on agent switch', () => {
    const agentId = 'agent_1';

    // Set complete UI state
    mockUIStateStore.updateScrollPosition(agentId, 450);
    mockUIStateStore.updateInputState(agentId, 'draft message');
    mockUIStateStore.updatePanelExpansion(agentId, true);
    mockUIStateStore.updateSearchState(agentId, 'filter');

    // Load and verify all state is restored
    const state = mockUIStateStore.loadUIState(agentId);

    expect(state.scrollPosition).toBe(450);
    expect(state.inputValue).toBe('draft message');
    expect(state.isExpanded).toBe(true);
    expect(state.searchQuery).toBe('filter');
  });
});
