# Redux Documentation Index

This directory contains app-specific Redux companion notes. The store API
surface is the local redux/saga-free shim at `src/lib/store-shim/`, imported
via `$lib/store-shim/...`.

If a guide here disagrees with the shim implementation, treat the shim as
current and fix or remove the stale companion text.

## Retained companion notes

1. [Redux Architecture Guide](./REDUX_ARCHITECTURE_GUIDE.md) — app-specific
   store/saga/source map and retained repository context.
2. [Reducers Guide](./REDUCERS_GUIDE.md) — repository-specific reducer notes
   that complement the reducer and core-policy skills.
3. [Selectors Guide](./SELECTORS_GUIDE.md) — repository-specific selector notes
   that complement the selector and selector-lifecycle skills.
4. [Migration Guide](./MIGRATION_GUIDE.md) — app-specific Svelte-store cleanup
   checklist.

## Related architecture notes

- [Agent Message Deduplication and Stream Saga Architecture](../../../../docs/agent-message-dedup-and-stream-sagas.md) — concrete example of thin service/lifecycle adapters, canonical reducer safety nets, and saga-owned stream reconciliation.
