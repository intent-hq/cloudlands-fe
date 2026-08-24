import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from './command-palette-commands';

describe('command palette command registry', () => {
  it('does not expose a workspace view-mode command', () => {
    expect(COMMAND_PALETTE_COMMANDS.map((command) => command.id)).not.toContain(
      'workspace-view-mode',
    );
  });
});
