/**
 * Comment ID Generator
 *
 * Centralized utility for generating comment IDs.
 * This ensures consistency between the notes service, MCP tools, and frontend.
 *
 * IMPORTANT: All comment creation code should use this utility to generate IDs.
 *
 * Design Decision: Frontend-Generated IDs
 * ========================================
 * Comment IDs are generated on the frontend for several reasons:
 *
 * 1. **Anchor Consistency**: Comment anchors are embedded in markdown using the
 *    comment ID (e.g., <!--anchor:uuid:start-->). If IDs were backend-generated,
 *    we'd need to insert temporary IDs, then rewrite the markdown after the
 *    backend response, risking race conditions during editing.
 *
 * 2. **Optimistic UI**: Users see comments immediately without waiting for
 *    backend round-trip, providing better UX.
 *
 * 3. **UUID Safety**: UUIDs have negligible collision risk (~10^-18 for 1 billion
 *    IDs), making frontend generation safe.
 *
 * 4. **Backend Validation**: The backend validates IDs and rejects invalid/duplicate
 *    IDs, maintaining data integrity.
 */

// Use browser's native crypto.randomUUID (available in all modern browsers)
// This file should work in both browser and Node.js environments
function generateUUID(): string {
  // Browser environment - use native crypto API
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments - generate UUID v4 manually
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a unique comment ID.
 *
 * Uses UUID v4 format for uniqueness and compatibility with the comment system.
 * Works in both browser and Node.js environments.
 *
 * @returns A unique comment ID (UUID v4 format)
 *
 * @example
 * const commentId = generateCommentId();
 * // Returns: "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateCommentId(): string {
  return generateUUID();
}

/**
 * Validate that a string is a valid comment ID.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid UUID (any version)
 */
export function isValidCommentId(id: string): boolean {
  // UUID format (any version): 8-4-4-4-12 hex digits
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
