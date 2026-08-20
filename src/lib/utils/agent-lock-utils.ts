/**
 * Agent Lock Utilities
 *
 * Shared utilities for determining if agent changes are "locked" and shouldn't be
 * manually staged/unstaged/reverted. This prevents users from accidentally interfering
 * with auto-commit when agents are working or have pending commits.
 *
 * A change is locked when:
 * 1. Auto-commit is globally enabled AND
 * 2. The change belongs to an agent that is either:
 *    - Actively working (streaming or task not in terminal status), OR
 *    - Has uncommitted changes that will be auto-committed
 */

import { m } from '$shared/paraglide/messages.js';

/**
 * The tooltip message to show when a file is locked.
 * Getter so the string re-resolves when the locale changes.
 */
export function getLockedTooltip(): string {
  return m.chat_changesPanel_lockedFile_tooltip();
}
