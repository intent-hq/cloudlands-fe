# Summary

Adopts the git.getConfig RPC from intentd#159 (STAB-10a) in DaemonWorkspaceRepository.

## Changes

- **git.getConfig RPC adoption**: DaemonWorkspaceRepository.readGitConfig now calls git.getConfig RPC when workspaceId is available, with filesystem fallback for backwards compatibility
- Updated repository interface to accept optional workspaceId parameter in readGitConfig
- Updated all call sites in workspace.service.ts to pass workspaceId
- Added comprehensive tests for the RPC path

## Scope Note

**workspace.getContext / updateContext RPCs NOT adopted** in this PR. After verification against PROTOCOL.md §5.1 and the FE source, these RPCs handle **chat-context items** (items: ContextItem[]) — the attachments panel — while DaemonWorkspaceRepository.readContext/saveContext serve **workspace UI context** (WorkspaceUIContext navigation state). These are different domains requiring separate daemon support. The workspace UI context adoption needs either:
1. A dedicated daemon RPC for UI context persistence, or  
2. Proper mapping between WorkspaceUIContext and chat-context items

Tracking as follow-up work.

## Testing

- Added unit tests for git.getConfig RPC path
- Updated integration tests to use FileSystemWorkspaceRepository directly
- All CI checks passing (11/11 ✅)

Closes STAB-10b (git.getConfig portion). Workspace context adoption deferred pending daemon-side support for UI context domain.
