import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('CodeEditor external content sync source guard', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/components/editor/CodeEditor.svelte'), 'utf-8');

  it('allows authoritative external refresh versions to sync while agent-follow mode is active', () => {
    expect(source).toContain('externalContentVersion?: number');
    expect(source).toContain('const hasNewExternalContent = contentVersion !== lastSyncedExternalContentVersion;');
    expect(source).toContain('if (!isFollowingAgent || hasNewExternalContent)');
    expect(source).toContain('lastSyncedExternalContentVersion = contentVersion;');
  });

  it('gates the file-too-large Open-in-VS-Code and Reveal buttons on workspace host locality (monorepo#2171)', () => {
    expect(source).toContain("selectIsWorkspaceHostLocal(workspaceIdStore)");
    expect(source).toContain('{#if workspaceId && filePath && $isWorkspaceHostLocal$}');
    // No ungated variant of the block remains.
    expect(source).not.toContain('{#if workspaceId && filePath}');
  });
});