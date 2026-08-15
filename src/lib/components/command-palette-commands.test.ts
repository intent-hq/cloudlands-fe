import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from './command-palette-commands';

describe('workspace view palette command registry', () => {
  it('describes the horizontal target while in tab view', () => {
    const command = COMMAND_PALETTE_COMMANDS('single').find(
      (candidate) => candidate.id === 'workspace-view-mode',
    );

    expect(command).toMatchObject({
      label: 'Switch to horizontal workspace view',
      description: 'Show open workspaces side by side in columns.',
      navigationIcon: 'spaces',
      searchText: 'tab horizontal stacked columns workspace view layout',
    });
    expect(command?.shortcut).toMatch(/L$/);
  });

  it('describes the tab target while in horizontal view', () => {
    expect(
      COMMAND_PALETTE_COMMANDS('columns').find(
        (candidate) => candidate.id === 'workspace-view-mode',
      ),
    ).toMatchObject({
      label: 'Switch to tab workspace view',
      description: 'Show one workspace at a time with tabs.',
      navigationIcon: 'tabs',
    });
  });
});
