import { all, call, put, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import {
  dockServiceUrlMatches,
  type DockServiceOwner,
  type DockShortcutContext,
} from '$shared/dock-shortcuts';
import type { ScriptListEntry, ScriptRuntimeState } from '$features/scripts/types';
import {
  captureDockPlacementBinding,
  isDockBindingCurrent,
} from '$features/hud/composer/dock-evidence-placement';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { selectScriptReadJournal } from '../../scripts/scripts-selectors';
import {
  beginScriptRead,
  isScriptReadCurrent,
  reconcileScriptRead,
} from '../../scripts/utils/script-read-context';
import { scriptReadFinished } from '../../scripts/scripts-slice';
import { getPrincipalConnectionContext } from '../../principal/principal-context';
import { store as appStore } from '../../../store';

function live(
  runtime: ScriptRuntimeState,
): runtime is ScriptRuntimeState & {
  runId: string;
  pid: number;
  startedAt: string;
  detectedUrl: string;
} {
  return (
    runtime.status === 'running' &&
    typeof runtime.runId === 'string' &&
    !!runtime.runId &&
    typeof runtime.pid === 'number' &&
    runtime.pid > 0 &&
    typeof runtime.startedAt === 'string' &&
    typeof runtime.detectedUrl === 'string'
  );
}
function address(context: DockShortcutContext): string | undefined {
  if (context.serviceAddress) return context.serviceAddress;
  try {
    const url = new URL(context.url ?? '');
    // A native browser's loopback is the client, not an arbitrary remote daemon.
    if (['localhost', '127.0.0.1', '[::1]', 'daemon.localhost'].includes(url.hostname)) return;
    return url.href;
  } catch {
    return;
  }
}
function* readWorkspace(workspaceId: string): SagaGenerator<ScriptListEntry[] | null> {
  const read = yield* beginScriptRead(workspaceId);
  try {
    const entries: ScriptListEntry[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = yield* call(() =>
        appClient.scripts.listPage(workspaceId, cursor ? { cursor } : undefined),
      );
      entries.push(...page.scripts);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) return null;
      if (cursor) seen.add(cursor);
    } while (cursor);
    const current = yield* reconcileScriptRead(read, entries);
    return current?.scripts ?? null;
  } catch {
    return null;
  } finally {
    yield* put(scriptReadFinished(workspaceId, read.requestId));
  }
}
/** No cached runtime or persisted port guess can admit an automatic destination. */
export function* findDockService(
  context: DockShortcutContext,
  workspaceIds: string[],
): SagaGenerator<DockServiceOwner | null> {
  const url = address(context);
  const binding = captureDockPlacementBinding();
  const connection = getPrincipalConnectionContext(appStore.state);
  if (!url || !connection || binding.backendId !== context.backendId) return null;
  const pages = yield* all(workspaceIds.map((id) => call(readWorkspace, id)));
  if (
    !isDockBindingCurrent(binding) ||
    connection !== getPrincipalConnectionContext(appStore.state) ||
    pages.some((page) => page === null)
  )
    return null;
  const candidates: DockServiceOwner[] = [];
  for (const rows of pages)
    for (const row of rows ?? []) {
      if (
        row.mode !== 'service' ||
        !workspaceIds.includes(row.workspaceId) ||
        !live(row.runtime) ||
        !dockServiceUrlMatches(url, row.runtime.detectedUrl)
      )
        continue;
      candidates.push({
        workspaceId: row.workspaceId,
        scriptId: row.id,
        backendId: context.backendId,
        connection,
        runId: row.runtime.runId,
        pid: row.runtime.pid,
        startedAt: row.runtime.startedAt,
        restartCount: row.runtime.restartCount,
        detectedUrl: row.runtime.detectedUrl,
      });
    }
  // Two processes advertising one address are uncertain, even in one workspace.
  return candidates.length === 1 ? candidates[0] : null;
}
/** Recheck the exact process/run on the same connection immediately before acting. */
export function* isDockServiceCurrent(owner: DockServiceOwner): SagaGenerator<boolean> {
  const binding = captureDockPlacementBinding();
  if (
    binding.backendId !== owner.backendId ||
    getPrincipalConnectionContext(appStore.state) !== owner.connection
  )
    return false;
  const read = yield* beginScriptRead(owner.workspaceId);
  try {
    const runtime = yield* call(() => appClient.scripts.status(owner.workspaceId, owner.scriptId));
    if (
      !runtime ||
      !isDockBindingCurrent(binding) ||
      owner.connection !== getPrincipalConnectionContext(appStore.state)
    )
      return false;
    // A racing lifecycle/definition event makes this status read uncertain.
    // Reject it rather than resurrecting an older process snapshot.
    if (!(yield* isScriptReadCurrent(read))) return false;
    const journal = selectScriptReadJournal.select(
      appStore.state,
      owner.workspaceId,
      read.requestId,
    );
    if (
      !journal ||
      getItems(journal).some((change) => {
        const id =
          change.kind === 'snapshot' || change.kind === 'read' ? change.script.id : change.scriptId;
        return id === owner.scriptId;
      })
    )
      return false;
    return (
      live(runtime) &&
      runtime.runId === owner.runId &&
      runtime.pid === owner.pid &&
      runtime.startedAt === owner.startedAt &&
      runtime.restartCount === owner.restartCount &&
      runtime.detectedUrl === owner.detectedUrl
    );
  } catch {
    return false;
  } finally {
    yield* put(scriptReadFinished(owner.workspaceId, read.requestId));
  }
}
