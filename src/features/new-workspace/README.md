# New workspace

`/workspace/new` is the only workspace-creation surface. It renders
`UntitledWorkspaceShell` while `new-workspace-route-controller.ts` owns one controller and
`createDraftTransactionRunner` executes its effects.

## Entry contract

All creation entry points call `navigateToNewWorkspace`. Resolver inputs are stored under a
per-navigation session key so multiple Untitled tabs create distinct daemon drafts. A `draft`
query parameter reopens that durable draft.

## Persistence and promotion

The daemon owns draft identity, revisions, persistence, promotion, and delivery state. The route
only presents controller state and forwards user events to the transaction runner. A one-time
migration imports the former sentinel prompt draft into a durable workspace draft, then clears the
sentinel.

## Boot authority

Fresh windows start at `/workspace/new`. Once the backend workspace list and persisted tabs are
available, the boot gate may restore an existing workspace. Provider and setup probes never choose
the page or replace typed Untitled input.