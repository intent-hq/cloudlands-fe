import { describe, expect, it } from 'vitest';
import type {
  PanelTab,
  PanelTabType,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import { getPanelExternalOpenTarget } from './panel-external-open-target';

const tab = (type: PanelTabType, extra: Partial<PanelTab> = {}): PanelTab => ({
  id: `${type}-tab`,
  type,
  title: type,
  closable: true,
  workspaceId: 'workspace-1',
  ...extra,
});

const workspaceRootTarget = {
  kind: 'path',
  filePath: '.',
  workspaceId: 'workspace-1',
  isDirectory: true,
  isWorkspaceRoot: true,
  workspaceFolderPath: '__WORKSPACE_ROOT__',
} as const;

describe('getPanelExternalOpenTarget', () => {
  it('returns the file target', () => {
    expect(getPanelExternalOpenTarget(tab('file', { filePath: 'src/app.ts' }), '', true)).toEqual({
      kind: 'path',
      filePath: 'src/app.ts',
      workspaceId: 'workspace-1',
      isDirectory: false,
    });
  });

  it('returns the diff target', () => {
    expect(getPanelExternalOpenTarget(tab('diff', { diffPath: 'src/app.ts' }), '', true)).toEqual({
      kind: 'path',
      filePath: 'src/app.ts',
      workspaceId: 'workspace-1',
      isDirectory: false,
      isDiff: true,
    });
  });

  it.each(['note', 'agent'] as const)('returns the workspace root for a %s tab', (type) => {
    expect(getPanelExternalOpenTarget(tab(type), '', true)).toEqual(workspaceRootTarget);
  });

  it('returns the browser target even when the workspace host is remote', () => {
    expect(
      getPanelExternalOpenTarget(tab('browser', { browserUrl: 'https://example.com' }), '', false),
    ).toEqual({ kind: 'browser', url: 'https://example.com' });
  });

  it('rejects path targets when the workspace host is remote', () => {
    expect(getPanelExternalOpenTarget(tab('file', { filePath: 'src/app.ts' }), '', false)).toEqual({
      kind: 'unavailable',
      reason: 'remote',
    });
  });

  it('returns the workspace root for other panel types', () => {
    expect(getPanelExternalOpenTarget(tab('terminal'), '', true)).toEqual(workspaceRootTarget);
  });
});
