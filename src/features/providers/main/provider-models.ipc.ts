/**
 * Registers every provider's `<provider>:get-models` main-process handler.
 * The Electron model picker sends these channels straight to main, so a
 * provider whose setup is not called here has no models on desktop.
 */

import { setupAntigravityIPC } from '../../antigravity/main/antigravity.ipc';
import { setupAuggieIPC } from '../../auggie/main/auggie.ipc';
import { setupClaudeCodeIPC } from '../../claude-code/main/claude-code.ipc';
import { setupCodexIPC } from '../../codex/main/codex.ipc';
import { setupCortexIPC } from '../../cortex/main/cortex.ipc';
import { setupCursorIPC } from '../../cursor/main/cursor.ipc';
import { setupDroidIPC } from '../../droid/main/droid.ipc';
import { setupGrokIPC } from '../../grok/main/grok.ipc';
import { setupOpencodeIPC } from '../../opencode/main/opencode.ipc';
import { setupPiIPC } from '../../pi/main/pi.ipc';
import { setupUnslothIPC } from '../../unsloth/main/unsloth.ipc';

export function setupProviderModelsIPC(): void {
  setupAntigravityIPC();
  setupAuggieIPC();
  setupClaudeCodeIPC();
  setupCodexIPC();
  setupCortexIPC();
  setupCursorIPC();
  setupDroidIPC();
  setupGrokIPC();
  setupOpencodeIPC();
  setupPiIPC();
  setupUnslothIPC();
}
