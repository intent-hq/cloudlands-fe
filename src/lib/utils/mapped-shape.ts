/**
 * Compile-time guard for hand-written `Source -> Target` mappers.
 *
 * Every key that `Source` and `Target` share by name becomes required in the
 * mapped literal (still accepting `undefined`, so `target.k = source.k` stays
 * assignable for optional keys), which makes silently dropping a shared field
 * a type error — e.g. a store mapper omitting a wire field that both the wire
 * type and the store type declare. Apply it to the returned literal with
 * `satisfies`; the declared return type stays `Target`.
 *
 * What it does NOT guard: keys that only exist on `Target` keep their own
 * optionality, and renamed fields (`model` -> `defaultModel`) are invisible to
 * a same-name check and remain hand-mapped.
 */
export type RequireSharedKeys<Source, Target> = Target & {
  [K in Extract<keyof Source, keyof Target>]-?: Target[K] | undefined;
};
