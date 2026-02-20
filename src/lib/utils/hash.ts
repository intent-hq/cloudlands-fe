/**
 * Convert a string to a numeric hash value.
 * Uses a simple hash algorithm suitable for seeding random number generators.
 *
 * @param str - String to hash
 * @returns Positive 32-bit integer hash value
 * @example
 * ```typescript
 * const hash = stringToHash('hello');
 * // Returns consistent hash value for the same input
 * ```
 */
export function stringToHash(str: string): number {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Seeded random number generator for deterministic randomness.
 * Produces the same sequence of random values for the same seed.
 *
 * @example
 * ```typescript
 * const rng = new SeededRandom(12345);
 * const value = rng.nextInt(100); // Always same for seed 12345
 * const item = rng.pick(['a', 'b', 'c']); // Deterministic selection
 * ```
 */
export class SeededRandom {
  private seed: number;

  /**
   * Create a new seeded random generator.
   *
   * @param seed - Initial seed value for the generator
   */
  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Generate next random value using linear congruential generator.
   *
   * @returns Random value between 0 and 1
   */
  private next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x80000000;
  }

  /**
   * Pick a random item from an array deterministically.
   *
   * @param array - Array to pick from
   * @returns Randomly selected item
   * @throws Error if array is empty
   * @example
   * ```typescript
   * const colors = ['red', 'green', 'blue'];
   * const color = rng.pick(colors);
   * ```
   */
  pick<T>(array: T[]): T {
    if (array.length === 0) throw new Error('Cannot pick from empty array');
    const index = Math.floor(this.next() * array.length);
    return array[index];
  }

  /**
   * Generate a random integer between 0 and max (exclusive).
   *
   * @param max - Upper bound (exclusive)
   * @returns Random integer in range [0, max)
   * @example
   * ```typescript
   * const diceRoll = rng.nextInt(6) + 1; // 1-6
   * ```
   */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/**
 * Create a seeded random generator from a string.
 * Useful for generating consistent random values based on identifiers.
 *
 * @param str - String to use as seed source
 * @returns Seeded random generator
 * @example
 * ```typescript
 * const rng = stringToSeededRandom('user-123');
 * // Always produces same sequence for 'user-123'
 * ```
 */
export function stringToSeededRandom(str: string): SeededRandom {
  return new SeededRandom(stringToHash(str));
}
