import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const chatPanelSource = readFileSync(resolve('src/lib/components/chat/ChatPanel.svelte'), 'utf8');
const agentTabTypeSource = readFileSync(
  resolve('src/features/layout/tab-types/AgentTabType.svelte'),
  'utf8',
);

describe('agent pane scroll persistence composition', () => {
  it('keys persisted state by the stable panel tab id', () => {
    expect(agentTabTypeSource).toContain('panelTabId={tab.id}');
    expect(chatPanelSource).toContain('panelTabId?: string');
    expect(chatPanelSource).toContain('selectPaneScrollState(panelTabId)');
  });

  it('prefers the live cache and falls back to restart-persisted state', () => {
    expect(chatPanelSource).toContain('getCachedChatScroll(workspace.id, agentId)');
    expect(chatPanelSource).toContain('$persistedPaneScrollState$');
    expect(chatPanelSource).toContain(
      'shouldFollowBottom = $state(cachedScroll?.shouldFollowBottom',
    );
  });

  it('saves fixed offsets and bottom-follow intent before unmount', () => {
    expect(chatPanelSource).toContain('savePaneScrollState(panelTabId');
    expect(chatPanelSource).toContain('canPersistPaneScroll(shouldFollowBottom)');
    expect(chatPanelSource).toContain('scrollTop: scrollContainer.scrollTop');
    expect(chatPanelSource).toContain('shouldFollowBottom,');
  });
});
