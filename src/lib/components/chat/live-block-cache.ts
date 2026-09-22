export interface LiveBlockCacheInput<Key, Context> {
  key: Key;
  input: string;
  context: Context;
}

interface LiveBlockCacheEntry<Context, Value> {
  input: string;
  context: Context;
  value: Value;
}

/** Retains computed values only for the entries present in the latest reconciliation. */
export class LiveBlockCache<Key, Context, Value> {
  private entries = new Map<Key, LiveBlockCacheEntry<Context, Value>>();

  reconcile(
    inputs: Iterable<LiveBlockCacheInput<Key, Context>>,
    compute: (input: string, context: Context) => Value,
  ): Map<Key, Value> {
    const nextEntries = new Map<Key, LiveBlockCacheEntry<Context, Value>>();
    const values = new Map<Key, Value>();

    for (const item of inputs) {
      const previous = this.entries.get(item.key);
      const value =
        previous && previous.input === item.input && Object.is(previous.context, item.context)
          ? previous.value
          : compute(item.input, item.context);
      nextEntries.set(item.key, { input: item.input, context: item.context, value });
      values.set(item.key, value);
    }

    this.entries = nextEntries;
    return values;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get retainedInputSize(): number {
    let size = 0;
    for (const entry of this.entries.values()) size += entry.input.length;
    return size;
  }
}
