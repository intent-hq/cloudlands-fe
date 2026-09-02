import { describe, expect, it } from 'vitest';
import type {
  PanelTab,
  PanelTabType,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import { getPanelExternalOpenTarget } from '../panel-external-open-target';

const tab = (type: PanelTabType, extra: Partial<PanelTab> = {}): PanelTab => ({
  id: `${type}-tab`,
  type,
  title: type,
  closable: true,
  workspaceId: 'workspace-1',
  ...extra,
});

describe('panel external open targets', () => {
  it('resolves exact file-backed resources', () => {
    expect(
      getPanelExternalOpenTarget(tab('file', { filePath: 'src/app.ts' }), '', true),
    ).toMatchObject({ kind: 'path', filePath: 'src/app.ts', isDirectory: false });
    expect(
      getPanelExternalOpenTarget(tab('diff', { diffPath: 'src/app.ts' }), '', true),
    ).toMatchObject({ kind: 'path', filePath: 'src/app.ts', isDiff: true });
    expect(getPanelExternalOpenTarget(tab('note', { noteId: 'spec' }), '', true)).toMatchObject({
      kind: 'path',
      filePath: '.workspace/notes/spec.md',
    });
    expect(
      getPanelExternalOpenTarget(tab('agent', { agentId: 'agent-1' }), '', true),
    ).toMatchObject({ kind: 'path', filePath: '.workspace/agents/agent-1.json' });
  });

  it('opens browser tabs in the system browser on local and remote workspaces', () => {
    const browser = tab('browser', { browserUrl: 'https://example.com' });
    expect(getPanelExternalOpenTarget(browser, '', true)).toEqual({
      kind: 'browser',
      url: 'https://example.com',
    });
    expect(getPanelExternalOpenTarget(browser, '', false)).toEqual({
      kind: 'browser',
      url: 'https://example.com',
    });
  });

  it.each<PanelTabType>([
    'changes',
    'local-changes',
    'chat-changes',
    'terminal',
    'settings',
    'overview',
    'hook-script',
    'activity',
    'activity-changes',
    'code-review',
    'agent-overview',
  ])('uses the workspace root for %s panels', (type) => {
    expect(getPanelExternalOpenTarget(tab(type), '', true)).toMatchObject({
      kind: 'path',
      filePath: '.',
      isDirectory: true,
      isWorkspaceRoot: true,
    });
  });

  it('rejects remote paths and unresolved file-backed resources', () => {
    expect(getPanelExternalOpenTarget(tab('file', { filePath: 'src/app.ts' }), '', false)).toEqual({
      kind: 'unavailable',
      reason: 'remote',
    });
    expect(getPanelExternalOpenTarget(tab('note', { noteId: undefined }), '', true)).toEqual({
      kind: 'unavailable',
      reason: 'missing-resource',
    });
  });
});
