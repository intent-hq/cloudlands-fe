import { tick } from 'svelte';
import { store as appStore } from '$store/renderer/store';
import type { StoreState } from '$store/renderer/types';
import {
  setWorkspaceViewMode,
  type WorkspaceViewMode,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  selectCurrentWorkspaceTabId,
  selectWorkspaceViewMode,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import {
  getWorkspaceContentViewTransitionName,
  getWorkspaceViewTransitionName,
  WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME,
} from '$lib/components/workspace/workspace-view-transition';

type WorkspaceViewModeAction = ReturnType<typeof setWorkspaceViewMode>;

interface WorkspaceViewModeStore {
  readonly state: StoreState;
  dispatch(action: WorkspaceViewModeAction): unknown;
}

type WorkspaceTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => WorkspaceViewTransition;
};

interface WorkspaceViewTransition {
  finished: Promise<void>;
  skipTransition?: () => void;
}

export interface WorkspaceViewModeActionOptions {
  store?: WorkspaceViewModeStore;
  documentRef?: WorkspaceTransitionDocument | null;
  reducedMotion?: boolean;
  afterUpdate?: () => Promise<void>;
}

interface ScrollContext {
  scrollLeft: number;
}

interface FocusContext {
  element: HTMLElement | null;
  restoreInsideWorkspace: boolean;
}

interface QueuedRequest {
  mode: WorkspaceViewMode;
  options: WorkspaceViewModeActionOptions;
}

const scrollContexts: Partial<Record<WorkspaceViewMode, ScrollContext>> = {};
let queuedRequest: QueuedRequest | null = null;
let activeTarget: WorkspaceViewMode | null = null;
let drainPromise: Promise<void> | null = null;
let activeTransition: WorkspaceViewTransition | null = null;
let cancelActiveTransition: (() => void) | null = null;
let requestWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

// Native snapshots are disabled until workspace surface ownership can guarantee that
// exactly one live tree participates on both sides of every transition.
const WORKSPACE_VIEW_TRANSITION_SNAPSHOTS_SAFE = false;

function getScroller(documentRef: Document, mode: WorkspaceViewMode): HTMLElement | null {
  return documentRef.querySelector<HTMLElement>(
    mode === 'single' ? '[data-workspace-tab-strip]' : '[data-workspace-columns]',
  );
}

function findWorkspaceElement(
  documentRef: Document,
  mode: WorkspaceViewMode,
  workspaceId: string,
): HTMLElement | null {
  const selector = mode === 'single' ? '[data-workspace-tab]' : '[data-workspace-column]';
  return (
    [...documentRef.querySelectorAll<HTMLElement>(selector)].find((element) =>
      mode === 'single'
        ? element.dataset.workspaceTab === workspaceId
        : element.dataset.workspaceColumn === workspaceId,
    ) ?? null
  );
}

function findTransitionShell(
  documentRef: Document,
  mode: WorkspaceViewMode,
  workspaceId: string,
): HTMLElement | null {
  if (mode === 'single') {
    return documentRef.querySelector<HTMLElement>('main.workspace-main');
  }
  const workspace = findWorkspaceElement(documentRef, mode, workspaceId);
  return workspace?.matches('section[data-workspace-column][data-workspace-transition-chrome]') &&
    workspace.dataset.workspaceTransitionChrome === workspaceId &&
    workspace.dataset.workspaceSurfaceState !== 'parked'
    ? workspace
    : null;
}

function isInsideWorkspace(element: HTMLElement | null, workspaceId: string | null): boolean {
  if (!element || !workspaceId) return false;
  const owner = element.closest<HTMLElement>('[data-workspace-tab], [data-workspace-column]');
  return (
    owner?.dataset.workspaceTab === workspaceId || owner?.dataset.workspaceColumn === workspaceId
  );
}

function captureFocus(documentRef: Document, workspaceId: string | null): FocusContext {
  const element =
    documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
  return { element, restoreInsideWorkspace: isInsideWorkspace(element, workspaceId) };
}

function restoreFocus(
  documentRef: Document,
  mode: WorkspaceViewMode,
  workspaceId: string | null,
  context: FocusContext,
): void {
  if (context.element?.isConnected || !context.restoreInsideWorkspace || !workspaceId) return;
  const workspace = findWorkspaceElement(documentRef, mode, workspaceId);
  const target =
    mode === 'single' ? workspace?.querySelector<HTMLElement>('[role="tab"]') : workspace;
  target?.focus({ preventScroll: true });
}

function restoreScroll(
  documentRef: Document,
  sourceMode: WorkspaceViewMode,
  nextMode: WorkspaceViewMode,
  workspaceId: string | null,
  sourceLeft: number | null,
): void {
  // Columns mode owns its own scroll position: WorkspaceColumnsView jumps to
  // the current workspace on mount, and a stale saved scrollLeft here would
  // clobber that jump. Only restore scroll when entering single mode.
  if (nextMode === 'columns') return;
  const destination = getScroller(documentRef, nextMode);
  if (!destination) return;

  const saved = scrollContexts[nextMode];
  if (saved) {
    destination.scrollLeft = Math.max(
      0,
      Math.min(saved.scrollLeft, Math.max(0, destination.scrollWidth - destination.clientWidth)),
    );
  }
  if (!workspaceId) return;

  const target = findWorkspaceElement(documentRef, nextMode, workspaceId);
  if (!target) return;
  const viewport = destination.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (viewport.right <= viewport.left || targetRect.right <= targetRect.left) return;
  if (targetRect.left >= viewport.left && targetRect.right <= viewport.right) return;

  const renderedWidth = viewport.right - viewport.left;
  const scrollScale = destination.clientWidth > 0 ? renderedWidth / destination.clientWidth : 1;
  const preferredLeft = Math.max(
    viewport.left,
    Math.min(
      sourceLeft ?? viewport.left,
      viewport.right - Math.min(targetRect.width, renderedWidth),
    ),
  );
  const nextScrollLeft = destination.scrollLeft + (targetRect.left - preferredLeft) / scrollScale;
  destination.scrollLeft = Math.max(
    0,
    Math.min(nextScrollLeft, Math.max(0, destination.scrollWidth - destination.clientWidth)),
  );
  void sourceMode;
}

function setTemporaryTransitionName(
  element: HTMLElement | null,
  name: string,
  usedNames: Set<string>,
): boolean {
  if (!element || usedNames.has(name)) return false;
  usedNames.add(name);
  element.style.setProperty('view-transition-name', name);
  element.dataset.workspaceTransitionName = name;
  return true;
}

function assignTransitionNames(
  documentRef: Document,
  mode: WorkspaceViewMode,
  activeWorkspaceId: string | null,
): { secondaryNames: string[]; contentNames: string[] } {
  const usedNames = new Set<string>();
  const secondaryNames: string[] = [];
  const contentNames: string[] = [];
  const shells =
    mode === 'single'
      ? [...documentRef.querySelectorAll<HTMLElement>('[data-workspace-tab]')]
      : [
          ...documentRef.querySelectorAll<HTMLElement>(
            '[data-workspace-column][data-workspace-transition-chrome]',
          ),
        ];

  for (const element of shells) {
    const workspaceId =
      mode === 'single' ? element.dataset.workspaceTab : element.dataset.workspaceColumn;
    if (!workspaceId) continue;
    if (mode === 'columns' && element.dataset.workspaceTransitionChrome !== workspaceId) continue;
    const isActive = workspaceId === activeWorkspaceId;
    if (mode === 'columns' && isActive && element.dataset.workspaceSurfaceState === 'parked') {
      continue;
    }
    if (mode === 'single' && isActive) continue;
    const name = isActive
      ? WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME
      : getWorkspaceViewTransitionName(workspaceId);
    if (setTemporaryTransitionName(element, name, usedNames) && !isActive)
      secondaryNames.push(name);
  }

  if (mode === 'single' && activeWorkspaceId) {
    setTemporaryTransitionName(
      findTransitionShell(documentRef, mode, activeWorkspaceId),
      WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME,
      usedNames,
    );
  }

  if (mode === 'columns') {
    const contents = [
      ...documentRef.querySelectorAll<HTMLElement>('[data-workspace-transition-content]'),
    ];
    for (const element of contents) {
      const workspaceId = element.dataset.workspaceTransitionContent;
      if (!workspaceId) continue;
      const name = getWorkspaceContentViewTransitionName(workspaceId);
      if (setTemporaryTransitionName(element, name, usedNames)) contentNames.push(name);
    }
  }

  setTemporaryTransitionName(
    documentRef.querySelector<HTMLElement>('[data-titlebar-workspace-controls]'),
    'workspace-view-titlebar-geometry',
    usedNames,
  );
  setTemporaryTransitionName(
    documentRef.querySelector<HTMLElement>('[data-sidebar-panel-frame]'),
    'workspace-view-sidebar-geometry',
    usedNames,
  );
  return { secondaryNames, contentNames };
}

function installTransitionSelectors(
  documentRef: Document,
  names: { secondaryNames: string[]; contentNames: string[] },
): void {
  documentRef.querySelector('[data-workspace-transition-style]')?.remove();
  const style = documentRef.createElement('style');
  style.dataset.workspaceTransitionStyle = '';
  const secondary = [...new Set(names.secondaryNames)];
  const contents = [...new Set(names.contentNames)];
  style.textContent = [
    ...secondary.flatMap((name) => [
      `html.workspace-view-to-columns::view-transition-old(${name}){animation:workspace-secondary-old-to-columns 160ms ease-out both}`,
      `html.workspace-view-to-columns::view-transition-new(${name}){animation:workspace-secondary-new-to-columns 220ms var(--ease-emphasized-out) 35ms both}`,
      `html.workspace-view-to-single::view-transition-old(${name}){animation:workspace-secondary-old-to-single 170ms ease-out both}`,
      `html.workspace-view-to-single::view-transition-new(${name}){animation:workspace-secondary-new-to-single 210ms var(--ease-emphasized-out) 30ms both}`,
    ]),
    ...contents.flatMap((name) => [
      `html.workspace-view-to-columns::view-transition-new(${name}){animation:workspace-content-reveal 90ms ease-out 55ms both}`,
      `html.workspace-view-to-single::view-transition-old(${name}){animation:workspace-content-recede 75ms ease-out both}`,
    ]),
  ].join('\n');
  documentRef.head.append(style);
}

function clearTransitionNames(documentRef: Document): void {
  for (const element of documentRef.querySelectorAll<HTMLElement>(
    '[data-workspace-transition-name]',
  )) {
    element.style.removeProperty('view-transition-name');
    delete element.dataset.workspaceTransitionName;
  }
}

function cleanupTransitionDocument(documentRef: Document): void {
  clearTransitionNames(documentRef);
  documentRef.querySelector('[data-workspace-transition-style]')?.remove();
  documentRef.documentElement.classList.remove(
    'workspace-view-transition',
    'workspace-view-to-columns',
    'workspace-view-to-single',
    'workspace-view-fallback',
  );
}

export function isWorkspaceViewModeRoute(pathname: string): boolean {
  return (
    pathname === '/workspace' ||
    (pathname.startsWith('/workspace/') && !pathname.startsWith('/workspace/new'))
  );
}

export function nextWorkspaceViewMode(viewMode: WorkspaceViewMode): WorkspaceViewMode {
  return viewMode === 'single' ? 'columns' : 'single';
}

async function animateFallbackDestination(
  documentRef: WorkspaceTransitionDocument,
  mode: WorkspaceViewMode,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId) return;
  const target = findTransitionShell(documentRef, mode, workspaceId);
  if (!target?.animate) return;
  const offset = mode === 'columns' ? 6 : -6;
  const animation = target.animate(
    [
      { opacity: 0.94, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ],
    { duration: 120, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
  await animation.finished.catch(() => undefined);
}

async function performModeChange(
  nextMode: WorkspaceViewMode,
  options: WorkspaceViewModeActionOptions,
): Promise<void> {
  const store = options.store ?? appStore;
  const sourceMode = selectWorkspaceViewMode.select(store.state);
  if (sourceMode === nextMode) return;

  const documentRef =
    options.documentRef ??
    (typeof document === 'undefined' ? null : (document as WorkspaceTransitionDocument));
  const reducedMotion =
    options.reducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const afterUpdate = options.afterUpdate ?? tick;
  const activeWorkspaceId = selectCurrentWorkspaceTabId.select(store.state);
  const sourceScroller = documentRef ? getScroller(documentRef, sourceMode) : null;
  const sourceWorkspace =
    documentRef && activeWorkspaceId
      ? findTransitionShell(documentRef, sourceMode, activeWorkspaceId)
      : null;
  const sourceLeft = sourceWorkspace?.getBoundingClientRect().left ?? null;
  const focusContext = documentRef
    ? captureFocus(documentRef, activeWorkspaceId)
    : { element: null, restoreInsideWorkspace: false };
  if (sourceScroller) scrollContexts[sourceMode] = { scrollLeft: sourceScroller.scrollLeft };

  let updateStarted = false;
  const update = async () => {
    updateStarted = true;
    store.dispatch(setWorkspaceViewMode(nextMode));
    await afterUpdate();
    if (!documentRef) return;
    restoreScroll(documentRef, sourceMode, nextMode, activeWorkspaceId, sourceLeft);
    restoreFocus(documentRef, nextMode, activeWorkspaceId, focusContext);
  };

  if (!documentRef) {
    await update();
    return;
  }

  if (reducedMotion || !WORKSPACE_VIEW_TRANSITION_SNAPSHOTS_SAFE) {
    cleanupTransitionDocument(documentRef);
    try {
      await update();
    } finally {
      cleanupTransitionDocument(documentRef);
    }
    return;
  }

  if (!documentRef.startViewTransition) {
    documentRef.documentElement.classList.add('workspace-view-fallback');
    try {
      await update();
      await animateFallbackDestination(documentRef, nextMode, activeWorkspaceId);
    } finally {
      cleanupTransitionDocument(documentRef);
    }
    return;
  }

  const directionClass =
    nextMode === 'columns' ? 'workspace-view-to-columns' : 'workspace-view-to-single';
  documentRef.documentElement.classList.add('workspace-view-transition', directionClass);
  const sourceNames = assignTransitionNames(documentRef, sourceMode, activeWorkspaceId);
  let resolveCancellation = () => {};
  const cancellation = new Promise<void>((resolve) => {
    resolveCancellation = resolve;
  });
  cancelActiveTransition = resolveCancellation;
  const handlePageHide = () => cancelWorkspaceViewModeTransition(documentRef);
  documentRef.defaultView?.addEventListener('pagehide', handlePageHide, { once: true });

  const transitionUpdate = async () => {
    clearTransitionNames(documentRef);
    await update();
    const destinationNames = assignTransitionNames(documentRef, nextMode, activeWorkspaceId);
    installTransitionSelectors(documentRef, {
      secondaryNames: [...sourceNames.secondaryNames, ...destinationNames.secondaryNames],
      contentNames: [...sourceNames.contentNames, ...destinationNames.contentNames],
    });
  };

  try {
    activeTransition = documentRef.startViewTransition.call(documentRef, transitionUpdate);
    await Promise.race([activeTransition.finished.catch(() => undefined), cancellation]);
  } catch {
    if (!updateStarted) await update();
  } finally {
    documentRef.defaultView?.removeEventListener('pagehide', handlePageHide);
    activeTransition = null;
    cancelActiveTransition = null;
    cleanupTransitionDocument(documentRef);
  }
}

async function drainRequests(): Promise<void> {
  try {
    while (queuedRequest) {
      const request = queuedRequest;
      queuedRequest = null;
      activeTarget = request.mode;
      await performModeChange(request.mode, request.options);
      activeTarget = null;
    }
    const waiters = requestWaiters;
    requestWaiters = [];
    waiters.forEach(({ resolve }) => resolve());
  } catch (error) {
    activeTarget = null;
    const waiters = requestWaiters;
    requestWaiters = [];
    waiters.forEach(({ reject }) => reject(error));
  }
}

function ensureDrain(): void {
  if (drainPromise) return;
  drainPromise = drainRequests().finally(() => {
    drainPromise = null;
    if (queuedRequest) ensureDrain();
  });
}

export function setWorkspaceViewModeWithTransition(
  nextMode: WorkspaceViewMode,
  options: WorkspaceViewModeActionOptions = {},
): Promise<void> {
  const store = options.store ?? appStore;
  if (!drainPromise && selectWorkspaceViewMode.select(store.state) === nextMode) {
    const documentRef =
      options.documentRef ??
      (typeof document === 'undefined' ? null : (document as WorkspaceTransitionDocument));
    if (documentRef) cleanupTransitionDocument(documentRef);
    return Promise.resolve();
  }

  queuedRequest = { mode: nextMode, options: { ...options, store } };
  const result = new Promise<void>((resolve, reject) => {
    requestWaiters.push({ resolve, reject });
  });
  ensureDrain();
  return result;
}

export function toggleWorkspaceViewModeWithTransition(
  options: WorkspaceViewModeActionOptions = {},
): Promise<void> {
  const store = options.store ?? appStore;
  const effectiveMode =
    queuedRequest?.mode ?? activeTarget ?? selectWorkspaceViewMode.select(store.state);
  return setWorkspaceViewModeWithTransition(nextWorkspaceViewMode(effectiveMode), {
    ...options,
    store,
  });
}

export function cancelWorkspaceViewModeTransition(
  documentRef: WorkspaceTransitionDocument | null = typeof document === 'undefined'
    ? null
    : (document as WorkspaceTransitionDocument),
): void {
  queuedRequest = null;
  delete scrollContexts.single;
  delete scrollContexts.columns;
  activeTransition?.skipTransition?.();
  cancelActiveTransition?.();
  if (documentRef) cleanupTransitionDocument(documentRef);
}
