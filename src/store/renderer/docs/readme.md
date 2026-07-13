# Redux Documentation Index

This directory contains app-specific Redux companion notes. Current architecture
rules, API guidance, and migration procedures are owned by the skills:

- [`ag-redux-toolkit`](../../../../.agents/skills/ag-redux-toolkit/SKILL.md)
- [`core-policy`](../../../../.agents/skills/ag-redux-toolkit/core/core-policy/SKILL.md)
- [`import-boundaries`](../../../../.agents/skills/ag-redux-toolkit/core/import-boundaries/SKILL.md)
- [`component-integration`](../../../../.agents/skills/ag-redux-toolkit/svelte/component-integration/SKILL.md)
- [`svelte/migration`](../../../../.agents/skills/ag-redux-toolkit/svelte/migration/SKILL.md)

If a guide here disagrees with those skills, treat the skill as current and fix
or remove the stale companion text.

## Retained companion notes

1. [Redux Architecture Guide](./REDUX_ARCHITECTURE_GUIDE.md) — app-specific
   store/saga/source map and retained repository context.
2. [Reducers Guide](./REDUCERS_GUIDE.md) — repository-specific reducer notes
   that complement the reducer and core-policy skills.
3. [Selectors Guide](./SELECTORS_GUIDE.md) — repository-specific selector notes
   that complement the selector and selector-lifecycle skills.
4. [waitFor Saga Utility Guide](./WAITFOR_SAGA_GUIDE.md) — app notes for waiting
   on Store conditions from sagas.
5. [Migration Guide](./MIGRATION_GUIDE.md) — app-specific Svelte-store cleanup
   checklist that complements the migration skill.

## Related architecture notes

- [Agent Message Deduplication and Stream Saga Architecture](../../../../docs/agent-message-dedup-and-stream-sagas.md) — concrete example of thin service/lifecycle adapters, canonical reducer safety nets, and saga-owned stream reconciliation.
