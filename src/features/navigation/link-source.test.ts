import { describe, expect, it } from 'vitest';
import { readLinkSource } from './link-source';

function nest(attributes: Record<string, string>[]): HTMLElement {
  let leaf = document.createElement('div');
  const root = leaf;
  for (const attrs of attributes) {
    for (const [name, value] of Object.entries(attrs)) leaf.setAttribute(name, value);
    const child = document.createElement('span');
    leaf.append(child);
    leaf = child;
  }
  document.body.append(root);
  return leaf;
}

describe('readLinkSource', () => {
  it('enters the workspace when the element sits in that workspace Home preview', () => {
    const element = nest([
      { 'data-panel-id': 'home-panel' },
      { 'data-workspace-link-target': 'ws-1' },
    ]);
    expect(readLinkSource(element, 'ws-1')).toEqual({
      openInWorkspace: true,
      panelId: 'home-panel',
      assistantLayoutId: undefined,
    });
  });

  it('does not enter a different workspace than the preview shows', () => {
    const element = nest([{ 'data-workspace-link-target': 'ws-other' }]);
    expect(readLinkSource(element, 'ws-1').openInWorkspace).toBe(false);
  });

  it('reads the panel of an ordinary workspace chat', () => {
    const element = nest([{ 'data-panel-id': 'panel-chat' }]);
    expect(readLinkSource(element, 'ws-1')).toEqual({
      openInWorkspace: false,
      panelId: 'panel-chat',
      assistantLayoutId: undefined,
    });
  });

  it('reads the Assistant layout the element belongs to', () => {
    const element = nest([{ 'data-assistant-layout-id': 'assistant-thread-1' }]);
    expect(readLinkSource(element, 'chief').assistantLayoutId).toBe('assistant-thread-1');
  });

  it('reports nothing for a missing element or workspace', () => {
    const element = nest([{ 'data-workspace-link-target': 'ws-1' }]);
    expect(readLinkSource(element, undefined).openInWorkspace).toBe(false);
    expect(readLinkSource(null, 'ws-1')).toEqual({
      openInWorkspace: false,
      panelId: undefined,
      assistantLayoutId: undefined,
    });
  });
});
