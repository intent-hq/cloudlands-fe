/**
 * Keychain Suppression
 *
 * Tracks temporary suppression of keychain-backed git operations after the
 * macOS keychain unlock prompt is cancelled or denied.
 *
 * IMPORTANT: Suppression is GLOBAL (not per-workspace) because:
 * 1. If a user denies keychain access for one workspace, they likely don't want
 *    to be prompted for ANY workspace (same credentials are used for all HTTPS repos)
 * 2. Having per-workspace suppression meant users would be spammed with dialogs
 *    when switching between workspaces or when the app loads multiple workspaces
 */

const DEFAULT_SUPPRESSION_MS = 2 * 60 * 1000; // 2 minutes

// Global suppression - if user denies once, suppress for ALL workspaces
let globalSuppressionUntil: number | null = null;

// Keep per-workspace map for backward compatibility (e.g., for clearing on success)
const suppressionByWorkspace = new Map<string, number>();

export function suppressKeychainAccess(workspaceId: string, durationMs = DEFAULT_SUPPRESSION_MS) {
  // Set GLOBAL suppression - affects all workspaces
  globalSuppressionUntil = Date.now() + durationMs;

  // Also set per-workspace for backward compatibility
  if (workspaceId) {
    suppressionByWorkspace.set(workspaceId, Date.now() + durationMs);
  }
}

export function isKeychainAccessSuppressed(workspaceId: string): boolean {
  // Check GLOBAL suppression first
  if (globalSuppressionUntil !== null) {
    if (Date.now() < globalSuppressionUntil) {
      return true;
    }
    // Global suppression expired
    globalSuppressionUntil = null;
  }

  // Fall back to per-workspace check for backward compatibility
  if (!workspaceId) return false;
  const until = suppressionByWorkspace.get(workspaceId);
  if (!until) return false;
  if (Date.now() >= until) {
    suppressionByWorkspace.delete(workspaceId);
    return false;
  }
  return true;
}

export function getKeychainSuppressionRemainingMs(workspaceId: string): number | null {
  // Check global suppression first
  if (globalSuppressionUntil !== null) {
    const globalRemaining = globalSuppressionUntil - Date.now();
    if (globalRemaining > 0) {
      return globalRemaining;
    }
    globalSuppressionUntil = null;
  }

  // Fall back to per-workspace
  if (!workspaceId) return null;
  const until = suppressionByWorkspace.get(workspaceId);
  if (!until) return null;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    suppressionByWorkspace.delete(workspaceId);
    return null;
  }
  return remaining;
}

export function clearKeychainSuppression(workspaceId: string): void {
  // Only clear the specific workspace's suppression on successful network op
  // We intentionally do NOT clear global suppression here - that should only expire naturally
  // This allows successful operations for one workspace to continue working
  // while still suppressing prompts for other workspaces that haven't been authenticated
  if (!workspaceId) return;
  suppressionByWorkspace.delete(workspaceId);
}

/**
 * Clear ALL suppression (global and per-workspace).
 * Use this when the user explicitly wants to re-authenticate (e.g., from settings).
 */
export function clearAllKeychainSuppression(): void {
  globalSuppressionUntil = null;
  suppressionByWorkspace.clear();
}
