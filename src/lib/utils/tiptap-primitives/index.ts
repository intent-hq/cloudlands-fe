/**
 * TipTap Primitives Index
 *
 * Export all custom TipTap nodes for note primitives
 */

/**
 * Decode base64 string to UTF-8 text, handling Unicode characters.
 * The encoding uses: btoa(String.fromCharCode(...new TextEncoder().encode(text)))
 * So decoding needs: new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
 */
export function decodeBase64Unicode(base64: string): string {
  const binaryString = atob(base64);
  const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Helper to get all node extensions
