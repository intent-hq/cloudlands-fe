---
name: migrate-to-svelte-redux-toolkit/cleanup
description: >-
  Delete old .store.svelte.ts files, verify zero residual references remain,
  and apply the rollback strategy if a migrated slice regresses. Final step
  per slice; also owns the risk-minimization checklist (one store per PR,
  tests, manual UI verification).
type: sub-skill
requires:
  - migrate-to-svelte-redux-toolkit
triggers:
  - delete old store
  - verify no references
  - migration rollback
  - migration cleanup
---
# Migration — Cleanup and Rollback

> Step 10 of the checklist, plus the rollback recipe. Run this once per slice,
> only after the new slice passes tests and the UI flows have been verified.

## Remove Old Store Files

Delete the old store file only after tests and UI checks pass. Verify zero references with targeted searches such as `grep -rn "{old-store}.store" src/` and `grep -rn "from.*stores/{old-store}" src/`; both must return no results.

Do not replace the deleted store with a barrel, re-export, or proxy module that
keeps the old import path alive. After a migration or refactor, the old module
path must be removed, inlined into the new owner, or explicitly kept as a
compatibility shim.

## Pass-Through Wrapper Guard

Check every old path touched by the migration, not only the `.store.svelte.ts`
file. Thin wrappers include:

- `export { ... } from "new/path"` or `export * from "new/path"`
- imports from the new file followed by identical exports
- functions/classes whose only behavior is calling the new implementation

Intentional shims must be rare and documented next to the shim with:

1. The compatibility consumer or release window that still imports the old path
2. The sunset/removal condition
3. The new import path callers should use

Verifier output must say either “no pass-through wrappers” or list each
documented compatibility shim and its removal condition.

## Rollback Strategy

If a migration needs to be reverted:

1. **Keep the old store file** in version control until the migration is verified
2. **Migrate one store at a time** — never batch multiple stores in one commit
3. **Use feature branches** — one branch per store migration
4. **Test thoroughly** before deleting the old store

### Reverting a migration

Rollback restores the old store file and affected components from git history, removes the new slice directory, removes the matching reducer constructor entry, and removes any matching `store.runSaga(sagaFn)` startup call from the app Store setup.

### Minimizing risk

- **Run all existing tests** after each store migration
- **Manually test affected UI flows** before committing
- **Keep PRs small** — one store = one PR
- **Verify zero references** to the old store before deleting it:
  `grep -rn "{old-store}" src/ --include="*.ts" --include="*.svelte"`

## Final Checklist Per Slice

- [ ] Reducer registered in `reducer.ts`
- [ ] Saga registered in `sagas.ts`
- [ ] All consuming components updated
  (see `skills/migrate-to-svelte-redux-toolkit/component-migration/SKILL.md`)
- [ ] All tests pass
- [ ] Manual UI verification done on affected flows
- [ ] Old `.store.svelte.ts` file deleted
- [ ] `grep` confirms zero references to the old store path
- [ ] Old module paths checked for one-line re-export/proxy/delegate leftovers
- [ ] Any remaining compatibility shim documents the reason and sunset/removal condition
- [ ] Commit message references the slice migrated (one store per PR)

## Examples in This Skill

- Added: zero-reference cleanup evidence; import replacement map; deletion readiness guard; documented compatibility shim; bad deletion with remaining consumers; final per-slice cleanup report.
- Retained: none (this cleanup skill previously had no JS/TS examples).

## Cleanup Examples

### 1. Record zero-reference search evidence

```typescript
type ReferenceSearch = {
  query: string;
  matches: string[];
};

export const oldCartStoreSearches: ReferenceSearch[] = [
  { query: "cart.store.svelte", matches: [] },
  { query: "from.*stores/cart", matches: [] },
];

export const canDeleteOldCartStore = oldCartStoreSearches.every((search) => search.matches.length === 0);
```

### 2. Track old imports replaced by new owners

```typescript
type ImportReplacement = {
  consumer: string;
  removedImport: string;
  addedImports: string[];
};

export const cartImportReplacements: ImportReplacement[] = [
  {
    consumer: "src/routes/cart/CartSummary.svelte",
    removedImport: "$lib/stores/cart.store.svelte",
    addedImports: [
      "$lib/store/slices/cart/cart-selectors",
      "$lib/store/slices/cart/cart-slice",
      "$lib/store/store",
    ],
  },
];
```

### 3. Gate deletion on tests, UI checks, and zero references

```typescript
type CleanupReadiness = {
  testsPass: boolean;
  manualFlowsPass: boolean;
  remainingReferences: number;
  passThroughWrappers: string[];
};

function isCleanupReady(readiness: CleanupReadiness): boolean {
  return readiness.testsPass
    && readiness.manualFlowsPass
    && readiness.remainingReferences === 0
    && readiness.passThroughWrappers.length === 0;
}

export const cartCleanupReady = isCleanupReady({
  testsPass: true,
  manualFlowsPass: true,
  remainingReferences: 0,
  passThroughWrappers: [],
});
```

### 4. Document a temporary compatibility shim when one is required

```typescript
/**
 * Compatibility shim for plugin-cart@2.x until that plugin releases its
 * cart selector migration. Remove after plugin-cart >= 3.0 is required.
 * New callers must import from "$lib/store/slices/cart/cart-selectors".
 */
export { selectCartTotal } from "$lib/store/slices/cart/cart-selectors";
```

### 5. ❌ Bad: delete while consumers still import the old store

```typescript
// ❌ BAD: this plan deletes an old store even though consumers still import it.
type BadCleanupPlan = {
  oldStorePath: string;
  consumersStillImportingOldPath: string[];
  deleteOldStoreNow: boolean;
};

export const badCleanupPlan: BadCleanupPlan = {
  oldStorePath: "src/lib/stores/cart.store.svelte.ts",
  consumersStillImportingOldPath: ["Header.svelte", "Checkout.svelte"],
  deleteOldStoreNow: true,
};
```

### 6. Produce final per-slice cleanup evidence

```typescript
type SliceCleanupReport = {
  slice: string;
  removedStoreFiles: string[];
  remainingOldPathMatches: string[];
  documentedShims: Array<{ path: string; removalCondition: string }>;
  verification: string[];
};

export const cartCleanupReport: SliceCleanupReport = {
  slice: "cart",
  removedStoreFiles: ["src/lib/stores/cart.store.svelte.ts"],
  remainingOldPathMatches: [],
  documentedShims: [],
  verification: ["cart reducer tests", "cart saga tests", "cart checkout manual flow"],
};
```

## Cases Covered

| Case | Example |
| --- | --- |
| Zero-reference proof | Record zero-reference search evidence |
| Consumer import migration | Track old imports replaced by new owners |
| Deletion readiness | Gate deletion on tests, UI checks, and zero references |
| Compatibility shim exception | Document a temporary compatibility shim when one is required |
| Unsafe cleanup | Bad: delete while consumers still import the old store |
| Final handoff evidence | Produce final per-slice cleanup evidence |

