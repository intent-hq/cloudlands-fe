Retire filesystem-backed context and git-config reads by switching to daemon RPCs (STAB-10b, intentd#159 e8a34b3f).

## Changes

- **DaemonWorkspaceRepository.readContext**: replaced filesystem fallback with `workspace.getContext` RPC
- **DaemonWorkspaceRepository.saveContext**: replaced filesystem fallback with `workspace.updateContext` RPC
- **DaemonWorkspaceRepository.readGitConfig**: replaced filesystem fallback with `git.getConfig` RPC; falls back to filesystem when workspaceId is unavailable
- Updated repository interface to add optional `workspaceId` parameter to `readGitConfig`
- Updated workspace.service.ts call sites to pass workspaceId:
  - `getGitRepoInfo`: now uses RPC for both local and remote workspaces (simplified logic, removed remote skip)
  - `createWorkspace`: now passes workspaceId in remoteContext
  - Two other call sites already had workspaceId

## Semantics

- **workspace.getContext** (§5.1): returns `{ items: ContextItem[] }`; returns empty array when nothing stored; null on error
- **workspace.updateContext** (§5.1): takes `{ workspaceId, items: ContextItem[] }`, returns persisted items; emits `workspace:context-changed`
- **git.getConfig** (§5.6, NEW in #159): returns `{ config: string }`; resolves linked worktrees (gitdir + commondir); walks parent dirs for nested repos; empty string for remote workspaces or non-repos

## Verification

Remote/non-repo workspaces gracefully degrade per RPC error codes. Filesystem fallback remains for cases where workspaceId is unavailable (though all current call sites now pass it).

Closes STAB-10b (intentd lane is #159, already merged).
