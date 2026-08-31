/**
 * Pure entry builder for the Window menu's open-windows section (main
 * process). Takes plain window descriptors + connection label records so the
 * labeling rules stay unit-testable without Electron.
 *
 * Label format: `<Kind> [<backend>]` — the `[<backend>]` suffix appears only
 * when at least one live window is stamped with a non-local backend; when
 * every window is local, entries are just the bare kind (no `[local]`).
 * Ordering: main windows first, then HUD windows; input order is kept within
 * each group.
 */

import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

/** A live app window, reduced to the fields the menu needs. */
export interface WindowMenuWindowDescriptor {
  windowId: number;
  isHud: boolean;
  backendId: string;
  isFocused: boolean;
}

/** Connection-label lookup record (subset of ConnectionRecord). */
export interface WindowMenuConnectionRecord {
  id: string;
  label?: string | null;
  hostname?: string | null;
}

/** Localized display strings the builder cannot resolve itself. */
export interface WindowMenuLabels {
  /** Kind label for main windows (the resolved app name, e.g. "Intent"). */
  mainWindowLabel: string;
  /** Kind label for HUD windows. */
  hudLabel: string;
  /** Backend label for local-backend windows (shown as `[<label>]`). */
  localBackendLabel: string;
}

export interface WindowMenuEntry {
  windowId: number;
  label: string;
  checked: boolean;
}

function backendLabel(
  backendId: string,
  connections: WindowMenuConnectionRecord[],
  labels: WindowMenuLabels,
): string {
  if (backendId === LOCAL_CONNECTION_ID) return labels.localBackendLabel;
  const record = connections.find((c) => c.id === backendId);
  return record?.label || record?.hostname || backendId;
}

/** Build the Window-menu entries for the given live windows. */
export function buildWindowMenuEntries(
  windows: WindowMenuWindowDescriptor[],
  connections: WindowMenuConnectionRecord[],
  labels: WindowMenuLabels,
): WindowMenuEntry[] {
  const hasRemote = windows.some((w) => w.backendId !== LOCAL_CONNECTION_ID);
  const ordered = [...windows.filter((w) => !w.isHud), ...windows.filter((w) => w.isHud)];
  return ordered.map((w) => {
    const kind = w.isHud ? labels.hudLabel : labels.mainWindowLabel;
    const label = hasRemote ? `${kind} [${backendLabel(w.backendId, connections, labels)}]` : kind;
    return { windowId: w.windowId, label, checked: w.isFocused };
  });
}
