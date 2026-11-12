import { tick, untrack } from 'svelte';
import type { DockEditorCompactIntent, DockPlacementCommand } from '$shared/dock-placement';

interface CompactState {
  request: DockEditorCompactIntent | null;
  revision: number;
  blocked: boolean;
  compact: boolean;
}

/** A single editor's collapse and paint receipt; a failed or cancelled handoff stays hidden. */
export function useDockEditorCompact(
  state: () => CompactState,
  collapse: () => void,
  publish: () => Promise<{ revision: number; version: number } | null>,
  command: (value: DockPlacementCommand) => void,
): void {
  let started = $state.raw<DockEditorCompactIntent | null>(null);
  let sent = $state.raw<DockEditorCompactIntent | null>(null);
  $effect(() => {
    const { request, blocked } = state();
    if (!request || request === started || blocked) return;
    untrack(() => {
      started = request;
      collapse();
    });
  });
  $effect(() => {
    const { request, revision, blocked, compact } = state();
    if (!request || request !== started || request === sent || blocked || !compact) return;
    let cancelled = false;
    const current = () => {
      const next = state();
      return (
        !cancelled &&
        request === next.request &&
        revision === next.revision &&
        !next.blocked &&
        next.compact
      );
    };
    // Wait for DOM commit and a painted compact frame, then require fresh native regions.
    void tick()
      .then(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      .then(async () => {
        if (!current()) return;
        const receipt = await publish();
        if (!receipt || !current() || receipt.revision !== revision) return;
        sent = request;
        command({
          action: 'release',
          editorCompact: { openId: request.openId, revision, pointerVersion: receipt.version },
        });
      });
    return () => {
      cancelled = true;
    };
  });
}
