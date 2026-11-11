import { untrack } from 'svelte';
import type { Workspace } from '$shared/types';
import { store } from '$store/renderer/store';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import { homeBulkActions } from './home-workspace-menu';
import {
  homeBulkTargets,
  isHomeRangeClick,
  isHomeRowClick,
  isHomeSelectionToggle,
  rangeHomeSelection,
  toggleHomeSelection,
  type HomeSelection,
} from './home-multi-select';

/**
 * Home's Cmd/Ctrl-click multi-selection. It is component-local UI state: two or more
 * selected rows replace the single preview, and rows that leave the view drop out.
 */
export function createHomeSelection(options: {
  /** Rows on screen, in any order. */
  visible: () => readonly Workspace[];
  /** The previewed row when it is on screen. */
  previewId: () => string | null;
  /** Row ids in screen order, for Shift-click ranges. */
  order: () => readonly string[];
  select: (id: string | null) => void;
}) {
  let multi = $state<string[]>([]);
  // Where Shift-click ranges start: the last plain or Cmd/Ctrl-clicked row.
  let anchor: string | null = null;
  const workspaces = $derived.by(() => {
    const visible = new Map<string, Workspace>(
      options.visible().map((workspace) => [workspace.id, workspace]),
    );
    return multi.flatMap((id) => visible.get(id) ?? []);
  });
  const active = $derived(workspaces.length >= 2);
  const ids = $derived<string[]>(workspaces.map((workspace) => workspace.id));
  const actions = $derived(
    homeBulkActions(
      homeBulkTargets(
        workspaces,
        (workspace) => !selectHidesOwnerWorkspaceActions.select(store.state, workspace.id),
      ),
    ),
  );
  $effect(() => {
    if (!active && multi.length) untrack(() => (multi = []));
  });

  function clear() {
    multi = [];
  }
  function selectOnly(id: string) {
    anchor = id;
    multi = [];
    options.select(id);
  }
  function apply(next: HomeSelection) {
    const previewId = options.previewId();
    multi = [...next.multi];
    if (next.selectedId !== previewId) options.select(next.selectedId);
  }
  function toggle(id: string) {
    anchor = id;
    apply(toggleHomeSelection({ multi: active ? ids : [], selectedId: options.previewId() }, id));
  }
  function range(id: string) {
    const next = rangeHomeSelection(options.order(), anchor ?? options.previewId(), id);
    if (next.multi.length === 0) anchor = id;
    apply(next);
  }

  return {
    get workspaces() {
      return workspaces;
    },
    get active() {
      return active;
    },
    get actions() {
      return actions;
    },
    /** Rows drawn as selected: the multi-selection, else the previewed row. */
    get selectedIds(): readonly string[] {
      const previewId = options.previewId();
      return active ? ids : previewId ? [previewId] : [];
    },
    includes: (id: string) => active && ids.includes(id),
    clear,
    selectOnly,
    toggle,
    range,
    /** List keyboard selection: always a single row. */
    pickRow(id: string | null) {
      anchor = id;
      multi = [];
      options.select(id);
    },
    /** Board card click: ends a multi-selection, else toggles the preview. */
    pickCard(id: string) {
      anchor = id;
      if (active) selectOnly(id);
      else options.select(options.previewId() === id ? null : id);
    },
    /** Escape ends a multi-selection before it closes the preview. */
    escape(event: KeyboardEvent): boolean {
      if (event.key !== 'Escape' || event.defaultPrevented || !active) return false;
      event.preventDefault();
      clear();
      return true;
    },
    /** List row click: true when the selection handled it (Cmd/Ctrl-click, or a click that ends it). */
    click(event: MouseEvent, id: string): boolean {
      if (isHomeSelectionToggle(event) || isHomeRangeClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) range(id);
        else toggle(id);
        return true;
      }
      if (!active || !isHomeRowClick(event)) return false;
      event.stopPropagation();
      selectOnly(id);
      return true;
    },
  };
}
