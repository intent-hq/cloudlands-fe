/**
 * Store for managing the keyboard shortcuts cheat sheet overlay state.
 * Similar to paletteStore for the command palette.
 *
 * Two display modes:
 * 2. Full cheat sheet: Complete keyboard shortcuts overlay
 *    - Opened via Cmd+/ or Ctrl+/
 *    - Stays open until Esc or clicking outside
 */

export type CheatSheetContext = 'global' | 'chat' | 'editor' | 'panel' | 'terminal';

class ShortcutsCheatSheetStore {
  isOpen = $state(false);
  context = $state<CheatSheetContext>('global');

  /** Open the full cheat sheet (via Cmd+/) */
  open(context: CheatSheetContext = 'global') {
    this.context = context;
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }

  toggle(context: CheatSheetContext = 'global') {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(context);
    }
  }
}

export const shortcutsCheatSheetStore = new ShortcutsCheatSheetStore();
