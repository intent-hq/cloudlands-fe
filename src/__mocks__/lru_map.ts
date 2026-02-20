/**
 * Mock for lru_map module
 * Used via resolve alias in vitest.config.ts
 */

export class LRUMap<K, V> extends Map<K, V> {
  private maxSize: number;

  constructor(limit: number) {
    super();
    this.maxSize = limit;
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      // Move to end for LRU
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): this {
    if (super.has(key)) {
      super.delete(key);
    } else if (super.size >= this.maxSize) {
      // Remove oldest
      const oldest = super.keys().next().value;
      if (oldest !== undefined) {
        super.delete(oldest);
      }
    }
    super.set(key, value);
    return this;
  }
}
