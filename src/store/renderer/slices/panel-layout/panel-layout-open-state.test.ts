import { describe, expect, it } from 'vitest';
import { getPanelTabOpenState } from './panel-layout-selectors';
import type { PanelTab } from './panel-layout-types';

describe('getPanelTabOpenState', () => {
  it('counts canonical matches and marks only the active match active', () => {
    const tabs: PanelTab[] = [
      {
        id: 'a',
        type: 'file',
        title: 'a',
        closable: true,
        workspaceId: 'ws',
        filePath: 'src/a.ts',
      },
      {
        id: 'b',
        type: 'file',
        title: 'b',
        closable: true,
        workspaceId: 'ws',
        filePath: 'src/./a.ts',
      },
    ];
    expect(
      getPanelTabOpenState(tabs, tabs[1], 'ws', { type: 'file', filePath: 'src/a.ts' }),
    ).toEqual({
      count: 2,
      isOpen: true,
      isActive: true,
      isOpenElsewhere: false,
    });
  });

  it('ignores equivalent tabs owned by another workspace', () => {
    const tabs: PanelTab[] = [
      { id: 'a', type: 'note', title: 'a', closable: true, workspaceId: 'other', noteId: 'n' },
    ];
    expect(getPanelTabOpenState(tabs, null, 'ws', { type: 'note', noteId: 'n' }).count).toBe(0);
  });
});
