/**
 * Agent Name Utilities (shared between main and renderer processes)
 *
 * Pure functions for classifying agent names. These are safe to use in both
 * main and renderer processes since they only depend on `unique-names-generator`
 * dictionaries (static data).
 */

/**
 * Check if a name is a "generic" agent name (e.g., "New Agent", "Orchestrator", "Assistant").
 * Generic names are default/placeholder names that should be overridden by intentional names.
 * Used by UI components to determine how to display agent names.
 * Note: Specialist-based names (e.g., "Coordinator", "Implementor 2") are NOT generic.
 */
export function isGenericAgentName(name: string | undefined | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return (
    normalized === 'new agent' ||
    normalized === 'orchestrator' ||
    normalized === 'assistant' ||
    normalized.startsWith('thread ') ||
    normalized.startsWith('workspace agent') ||
    // Match "Chat HH-MM AM/PM" pattern from legacy timestamp-based names
    /^chat \d{1,2}-\d{2} (am|pm)$/i.test(normalized)
  );
}

/**
 * Check if a name is actually a raw agent id (e.g. "agent-<uuid>").
 * UI surfaces must never render these as display names.
 */
export function looksLikeAgentId(name: string): boolean {
  return /^agent-[a-f0-9-]{36}$/i.test(name);
}
