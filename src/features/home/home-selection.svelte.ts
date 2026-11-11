import { untrack } from 'svelte';
import type { Workspace } from '$shared/types';
import { store } from '$store/renderer/store';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import { homeBulkActions } from './home-workspace-menu';
import {
  homeBulkTargets,
  isHomeRowClick,
  isHomeSelectionToggle,
  toggleHomeSelection,
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
  select: (id: string | null) => void;
}) {
  let multi = $state<string[]>([]);
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
    multi = [];
    options.select(id);
  }
  function toggle(id: string) {
    const previewId = options.previewId();
    const next = toggleHomeSelection({ multi: active ? ids : [], selectedId: previewId }, id);
    multi = [...next.multi];
    if (next.selectedId !== previewId) options.select(next.selectedId);
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
    /** List keyboard selection: always a single row. */
    pickRow(id: string | null) {
      multi = [];
      options.select(id);
    },
    /** Board card click: ends a multi-selection, else toggles the preview. */
    pickCard(id: string) {
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
      if (isHomeSelectionToggle(event)) {
        event.preventDefault();
        event.stopPropagation();
        toggle(id);
        return true;
      }
      if (!active || !isHomeRowClick(event)) return false;
      event.stopPropagation();
      selectOnly(id);
      return true;
    },
  };
}
