import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDockLastTool, rememberDockLastTool } from './dock-composer-last-tool';
import {
  dockConversationReducer as reduce,
  dockEvidenceToolRemembered,
  dockEvidenceToolSet,
} from './dock-conversation-slice';

// Failure inventory: a tool leaks to another workspace or backend; a corrupt or
// foreign stored value becomes a tool; a remembered tool counts as "used" (the
// annotate button must keep its pencil until a tool is chosen this session).
describe('dock annotate tool memory', () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.mocked(localStorage.getItem).mockImplementation((key) => stored.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => stored.set(key, value));
  });

  it('remembers the last tool per backend and workspace, first use falling back to none', () => {
    expect(readDockLastTool('backend-1', 'ws-a')).toBeNull();
    rememberDockLastTool('backend-1', 'ws-a', 'box');
    rememberDockLastTool('backend-1', 'ws-a', 'arrow');
    rememberDockLastTool('backend-1', 'ws-b', 'pen');
    expect(readDockLastTool('backend-1', 'ws-a')).toBe('arrow');
    expect(readDockLastTool('backend-1', 'ws-b')).toBe('pen');
    expect(readDockLastTool('backend-2', 'ws-a')).toBeNull();
  });

  it('ignores corrupt storage and values that are not annotate tools', () => {
    stored.set('dock:lastToolByWorkspace', '{not json');
    expect(readDockLastTool('backend-1', 'ws-a')).toBeNull();
    stored.set(
      'dock:lastToolByWorkspace',
      JSON.stringify({ [JSON.stringify(['backend-1', 'ws-a'])]: 'rectangle' }),
    );
    expect(readDockLastTool('backend-1', 'ws-a')).toBeNull();
  });

  it('keeps a remembered tool separate from a tool chosen this session', () => {
    let state = reduce(undefined, dockEvidenceToolRemembered('ws-a', 'pen'));
    expect(state.rememberedToolByWorkspace).toEqual({ 'ws-a': 'pen' });
    expect('ws-a' in state.toolByWorkspace).toBe(false);
    state = reduce(state, dockEvidenceToolSet('ws-a', 'box'));
    expect(state.toolByWorkspace).toEqual({ 'ws-a': 'box' });
  });
});
