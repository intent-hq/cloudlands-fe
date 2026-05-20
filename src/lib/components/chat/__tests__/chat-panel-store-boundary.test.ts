import {
  describe,
  expect,
  it,
} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHAT_PANEL_FILE = path.resolve(__dirname, '..', 'ChatPanel.svelte');

describe('ChatPanel store import boundaries', () => {
  it('reads collection-backed terminal data through selectors, not collection utils', () => {
    const source = fs.readFileSync(CHAT_PANEL_FILE, 'utf-8');

    expect(source).not.toContain("svelte-redux-toolkit/utils/collections/collection-utils");
    expect(source).toContain('selectWorkspaceSetupTerminal');
  });
});
