import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_PANEL_FILE = path.resolve(__dirname, '..', 'ChatPanel.svelte');

describe('ChatPanel store import boundaries', () => {
  it('reads collection-backed terminal data through selectors, not collection utils', () => {
    const source = fs.readFileSync(CHAT_PANEL_FILE, 'utf-8');

    expect(source).not.toContain('$lib/store-shim/utils/collections/collection-utils');
    expect(source).toContain('selectWorkspaceSetupTerminal');
  });

  it('renders messages directly from agent-session state without a local optimistic layer', () => {
    const source = fs.readFileSync(CHAT_PANEL_FILE, 'utf-8');

    expect(source).toContain('groupMessagesByDate($agentMessages$)');
    expect(source).not.toContain('visibleAgentMessages');
    expect(source).not.toContain('stageOptimisticUserMessage');
    expect(source).not.toContain('chat-panel-optimistic-message');
    expect(source).toContain('messageId={message.id}');
  });
});
