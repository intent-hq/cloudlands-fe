/**
 * Agent Lock Utilities
 *
 * Presentation helpers for daemon-computed agent/file locks (PROTOCOL §5.19 /
 * §6.5). The lock computation itself lives in the daemon; the FE only renders
 * the published state. Locked changes shouldn't be manually staged/unstaged/
 * reverted, to prevent users from interfering with auto-commit.
 */

import { m } from '$shared/paraglide/messages.js';

/**
 * The tooltip message to show when a file is locked.
 * Getter so the string re-resolves when the locale changes.
 */
export function getLockedTooltip(): string {
  return m.chat_changesPanel_lockedFile_tooltip();
}
