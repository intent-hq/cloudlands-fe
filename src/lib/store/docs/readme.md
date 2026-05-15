# Redux Documentation Index

Documentation for the Redux architecture in the Augment Chat application.

## Quick Start

1. [Redux Architecture Guide](./REDUX_ARCHITECTURE_GUIDE.md) — Overall architecture, actions, sagas, collections, channels, slice management, performance
2. [Reducers Guide](./REDUCERS_GUIDE.md) — Reducer patterns, immutability, do's and don'ts, testing
3. [Selectors Guide](./SELECTORS_GUIDE.md) — Custom selector system, memoization, usage in components and sagas, anti-patterns
4. [waitFor Saga Utility Guide](./WAITFOR_SAGA_GUIDE.md) — Waiting for state conditions in sagas, known limitations
5. [Migration Guide](./MIGRATION_GUIDE.md) — Migrating Svelte 5 rune-based stores to Redux slices, mapping rules, step-by-step checklist

## Related Architecture Notes

- [Agent Message Deduplication and Stream Saga Architecture](../../../../docs/agent-message-dedup-and-stream-sagas.md) — Concrete example of thin service/lifecycle adapters, canonical reducer safety nets, and saga-owned stream reconciliation
