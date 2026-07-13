/**
 * Browser-safe crypto utilities
 *
 * Provides crypto functions that work in both Node.js and browser environments
 */

/**
 * Creates a SHA-256 hash of the input string
 * Works in both browser and Node.js environments
 */
export async function createHash(input: string): Promise<string> {
  // Use Web Crypto API if available (browser and modern Node.js)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  // Fallback for environments without Web Crypto API
  // This is a simple hash function for deduplication purposes
  // Not cryptographically secure, but sufficient for content hashing
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * Creates a short hash suitable for deduplication
 * Returns first 16 characters of the hash
 */
export async function createShortHash(input: string): Promise<string> {
  const fullHash = await createHash(input);
  return fullHash.substring(0, 16);
}

/**
 * Generate a random UUID
 * Works in both browser and Node.js environments
 */
export function randomUUID(): string {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate random bytes
 * Works in both browser and Node.js environments
 */
export function getRandomValues(length: number): Uint8Array {
  const array = new Uint8Array(length);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    return globalThis.crypto.getRandomValues(array);
  }

  // Fallback using Math.random (not cryptographically secure)
  for (let i = 0; i < length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return array;
}
