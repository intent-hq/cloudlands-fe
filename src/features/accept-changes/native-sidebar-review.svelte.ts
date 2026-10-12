import { onDestroy, untrack } from 'svelte';
import { fromStore, toStore } from 'svelte/store';
import { store as appStore } from '$store/renderer/store';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { backgroundGitActionsService } from '$features/accept-changes/background-git-actions.service';
import {
  repositoryContextDemanded,
  repositoryContextDemandEnded,
  nativeReviewConfirmRequested,
  nativeReviewCompanionRequested,
  nativeReviewReconcileRequested,
  nativeReviewEditEnded,
} from '$store/renderer/slices/repository-context/repository-context-slice';
import { setPRWorkflowDrawer } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
import { setPRContent } from '$store/renderer/slices/changes/changes-slice';
import { selectAcceptChangesState } from '$store/renderer/slices/changes/changes-selectors';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import { prRepositoryOptions } from './utils/pr-repository-options';
import { confirm } from '$lib/components/patterns/confirm';

import { store } from '$store/renderer/store';
import {
  selectRepositoryContextForDemand,
  selectNativeReviewForOwner,
  selectNativeReviewOccupancy,
} from '$store/renderer/slices/repository-context/repository-context-selectors';
import {
  executionScopeKey,
  repositoryTargetKey,
  repositoryRootKey,
} from '$shared/types/repository-context';
import type { RepositoryContextDemand } from '$store/renderer/slices/repository-context/repository-context-types';
import type { NativeReviewOwner } from '$shared/types/native-review-operation';
import type { NativeSidebarReviewIntent } from '$store/renderer/slices/changes/changes-types';

type NativeLifetimeSnapshot = Readonly<{
  parent: NativeReviewOwner | null;
  child: NativeReviewOwner | null;
  demand: RepositoryContextDemand | null;
  host: NativeReviewOwner['hostContext'];
}>;
type NativeRetirementSubscription = Readonly<{
  instance: symbol;
  completion: Promise<void>;
  cancel: (reason: unknown) => void;
  release: () => void;
}>;

// This observer owns no command capability. Its promise is completed only by
// the original component's normal cleanup and destruction paths.
function createNativeRetirement(
  instance: symbol,
  read: () => NativeLifetimeSnapshot,
  isClosed: (owner: NativeReviewOwner) => boolean,
) {
  const copyOwner = (owner: NativeReviewOwner | null) =>
    owner ? Object.freeze({ ...owner, root: Object.freeze({ ...owner.root }) }) : null;
  const initial = read();
  const captured: NativeLifetimeSnapshot = Object.freeze({
    parent: copyOwner(initial.parent),
    child: copyOwner(initial.child),
    demand: initial.demand ? Object.freeze({ ...initial.demand }) : null,
    host: initial.host,
  });
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  let active = true;
  let settled = false;
  let demandEnded = captured.demand === null;
  const completion = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The original promise remains rejected; observing it cannot interrupt cleanup.
  void completion.catch(() => {});
  function fail(reason: unknown) {
    if (!active || settled) return;
    settled = true;
    reject(reason);
  }
  function observe(run: () => void) {
    if (!active || settled) return;
    try {
      run();
    } catch (error) {
      fail(error);
    }
  }
  const sameOwner = (a: NativeReviewOwner | null, b: NativeReviewOwner | null) =>
    a === null
      ? b === null
      : b !== null &&
        a.attemptId === b.attemptId &&
        a.admission === b.admission &&
        a.hostContext === b.hostContext &&
        repositoryRootKey(a.root) === repositoryRootKey(b.root);
  function acknowledge(original: NativeLifetimeSnapshot) {
    for (const key of ['parent', 'child'] as const) {
      if (original[key] !== null && !sameOwner(original[key], captured[key]))
        throw new Error('Native retirement owner changed');
    }
    if (original.demand) {
      if (
        !captured.demand ||
        original.demand.workspaceId !== captured.demand.workspaceId ||
        original.demand.demandId !== captured.demand.demandId ||
        original.demand.admission !== captured.demand.admission ||
        original.host !== captured.host
      )
        throw new Error('Native retirement demand changed');
      demandEnded = true;
    }
  }
  const subscription: NativeRetirementSubscription = Object.freeze({
    instance,
    completion,
    cancel: fail,
    release() {
      fail(new Error('Native retirement observation released before completion'));
      active = false;
    },
  });
  return {
    subscription,
    cleanup<T>(originalCleanup: () => T): T {
      let original: NativeLifetimeSnapshot | undefined;
      observe(() => {
        original = read();
      });
      let result: T;
      try {
        result = originalCleanup();
      } catch (error) {
        fail(error);
        throw error;
      }
      observe(() => {
        if (original) acknowledge(original);
      });
      return result;
    },
    destroyed() {
      observe(() => {
        const remaining = read();
        if (remaining.parent || remaining.child || remaining.demand)
          throw new Error('Native retirement left component owners');
        if (
          !demandEnded ||
          [captured.parent, captured.child].some((owner) => owner && !isClosed(owner))
        )
          throw new Error('Native retirement lacks original closure');
        settled = true;
        resolve();
      });
    },
  };
}

const selectNativeRead = store.createSelector((state, demand: RepositoryContextDemand | null) => {
  const view = demand ? selectRepositoryContextForDemand.select(state, demand) : null;
  const entry =
    view?.status === 'ready'
      ? view.roots.find(
          (r) => r.root.kind === 'primary' && r.root.workspaceId === demand?.workspaceId,
        )
      : null;
  const selected =
    entry?.reviewSelection.outcome.state === 'resolved'
      ? entry.reviewSelection.outcome.target
      : null;
  const target =
    selected &&
    entry?.targets.some(
      (item) =>
        repositoryTargetKey(item.target) === repositoryTargetKey(selected) &&
        item.availability === 'connected',
    )
      ? selected
      : null;
  const destinationKey =
    target && view?.scope
      ? JSON.stringify([
          demand?.workspaceId,
          executionScopeKey(view.scope),
          repositoryTargetKey(target),
          entry?.branch,
        ])
      : null;
  return {
    view,
    entry: entry ?? null,
    canChooseRepository: prRepositoryOptions(entry ?? null).length > 0,
    target,
    destinationKey,
    contextKey:
      destinationKey && view?.revision
        ? JSON.stringify([destinationKey, view.revision.epoch, view.revision.sequence])
        : null,
  };
});
const selectNativeAttempt = store.createSelector((state, owner: NativeReviewOwner | null) =>
  owner ? selectNativeReviewForOwner.select(state, owner) : null,
);
type SidebarProps = {
  workspaceId: string;
  remoteSaving: boolean;
  nativeReview: boolean;
  listOnly: boolean;
  isOwner: boolean;
  hasRemote: boolean;
  hasStaged: boolean;
  hasCommits: boolean;
  hasOpenPR: boolean;
  isMergedToTrunk: boolean;
  areAllPRsMerged: boolean;
  hasResetToTrunk: boolean;
  isContentMergedToTrunk: boolean;
  hasNewWorkAfterMerge: boolean;
  prDrawerOpen: boolean;
  prTitle: string;
  prDescription: string;
  _commitMessage: string;
  onMergeDrawerToggle: (open: boolean) => void;
  canHostOperations: boolean;
  admittedGuest: boolean;
  hostContext: ReturnType<typeof selectWorkspaceActionContext.select>;
  admission: string | null;
  baseRef: string;
  labsEnabled: boolean;
};

export function createNativeSidebarReview(readProps: () => SidebarProps) {
  const workspaceId = $derived(readProps().workspaceId);
  const nativeReview = $derived(readProps().nativeReview);
  const listOnly = $derived(readProps().listOnly);
  const isOwner = $derived(readProps().isOwner);
  const hasRemote = $derived(readProps().hasRemote);
  const hasStaged = $derived(readProps().hasStaged);
  const prDrawerOpen = $derived(readProps().prDrawerOpen);
  const _commitMessage = $derived(readProps()._commitMessage);
  const onMergeDrawerToggle = $derived(readProps().onMergeDrawerToggle);
  const hostOperationContext = $derived(readProps().hostContext);
  const nativeEnabled = $derived(readProps().labsEnabled);
  const nativeAdmission = $derived(readProps().admission);
  let nativeDemand = $state.raw<RepositoryContextDemand | null>(null);
  let nativeDemandHost = $state<ReturnType<typeof selectWorkspaceActionContext.select>>(null);
  let nativeIntent = $state.raw<NativeSidebarReviewIntent | null>(null);
  let nativeChild = $state.raw<NativeReviewOwner | null>(null);
  let nativeBranch = $state('');
  let nativeMessage = $state('');
  let nativeQueued = $state<string | null>(null);
  let nativeConfirming = $state<string | null>(null);
  let nativeParentClaimed = $state(false);
  let nativeChildClaimed = $state(false);
  let nativeChecking = $state<string | null>(null);
  let nativeReadChanged = $state(false);
  let nativeReadKey = $state<string | null>(null);
  const nativeRead = fromStore(selectNativeRead(toStore(() => nativeDemand)));
  const nativeParentView = fromStore(
    selectNativeAttempt(toStore(() => nativeIntent?.owner ?? null)),
  );
  const nativeChildView = fromStore(selectNativeAttempt(toStore(() => nativeChild)));
  const nativeEntryWithoutOrigin = $derived(
    nativeReview && nativeEnabled && !listOnly && isOwner && !hasRemote,
  );
  const nativeMode = $derived(
    nativeReview && nativeEnabled && nativeRead.current.target?.provider !== 'github',
  );
  const nativeCommitResult = $derived(nativeParentView.current?.observation?.execute);
  const nativeCanContinue = $derived(
    !!nativeIntent &&
      !nativeChild &&
      !nativeConfirming &&
      nativeParentView.current?.status !== 'unavailable' &&
      nativeCommitResult?.state === 'settled' &&
      nativeCommitResult.success &&
      !nativeParentView.current?.observation?.uncertain &&
      nativeCommitResult.reviewExecution?.outcome.status === 'not-attempted' &&
      nativeCommitResult.reviewExecution.gitReceipts.length === 1 &&
      nativeCommitResult.reviewExecution.gitReceipts[0].stage === 'commit',
  );

  const nativeInstance = Symbol('PRSection native lifetime');
  let nativeDestroyed = false;
  let nativeRetirement: ReturnType<typeof createNativeRetirement> | null = null;
  function readNativeLifetime(): NativeLifetimeSnapshot {
    return {
      parent: nativeIntent?.owner ?? null,
      child: nativeChild,
      demand: nativeDemand,
      host: nativeDemandHost,
    };
  }
  function observeNativeRetirement(): NativeRetirementSubscription {
    if (nativeDestroyed) throw new Error('Original native component already destroyed');
    nativeRetirement ??= createNativeRetirement(nativeInstance, readNativeLifetime, (owner) => {
      const row = selectNativeReviewOccupancy.select(appStore.state, owner.attemptId);
      return (
        !!row &&
        row.status === 'closed' &&
        row.owner.admission === owner.admission &&
        row.owner.hostContext === owner.hostContext &&
        repositoryRootKey(row.owner.root) === repositoryRootKey(owner.root)
      );
    });
    const original = nativeRetirement;
    return Object.freeze({
      ...original.subscription,
      release() {
        original.subscription.release();
        if (nativeRetirement === original) nativeRetirement = null;
      },
    });
  }
  function closeNative() {
    if (!nativeRetirement) return closeNativeOriginal();
    return nativeRetirement.cleanup(closeNativeOriginal);
  }

  function endNativeOwners() {
    const parent = nativeIntent?.owner,
      child = nativeChild;
    nativeIntent = null;
    nativeChild = null;
    nativeQueued = null;
    nativeConfirming = null;
    nativeParentClaimed = false;
    nativeChildClaimed = false;
    nativeChecking = null;
    if (child) appStore.dispatch(nativeReviewEditEnded(child));
    if (parent) appStore.dispatch(nativeReviewEditEnded(parent));
  }
  function closeNativeOriginal() {
    endNativeOwners();
    const original = nativeDemand;
    nativeDemand = null;
    nativeDemandHost = null;
    if (original)
      appStore.dispatch(
        repositoryContextDemandEnded(original.workspaceId, original.demandId, original.admission),
      );
  }
  function startNativeRead() {
    closeNative();
    nativeReadChanged = false;
    nativeReadKey = null;
    const original = Object.freeze({
      workspaceId,
      demandId: crypto.randomUUID(),
      admission: selectPrincipalActionContext.select(appStore.state),
    });
    nativeDemandHost = selectWorkspaceActionContext.select(appStore.state, workspaceId);
    nativeDemand = original;
    appStore.dispatch(
      repositoryContextDemanded(original.workspaceId, original.demandId, original.admission),
    );
  }
  function togglePRDrawer() {
    const open = !prDrawerOpen;
    appStore.dispatch(setPRWorkflowDrawer(workspaceId, 'prDrawerOpen', open));
    if (open) {
      onMergeDrawerToggle(false);
      if (nativeReview && nativeEnabled) {
        nativeBranch = readProps().baseRef;
        nativeMessage = _commitMessage;
        if (!nativeDemand) startNativeRead();
      }
    } else closeNative();
  }
  function nativeEligible(owner: NativeReviewOwner) {
    const original = nativeIntent;
    if (
      !original ||
      (owner !== original.owner && owner !== nativeChild) ||
      !prDrawerOpen ||
      listOnly ||
      workspaceId !== owner.root.workspaceId ||
      selectWorkspaceActionContext.select(appStore.state, workspaceId) !== owner.hostContext ||
      selectPrincipalActionContext.select(appStore.state) !== owner.admission
    )
      return false;
    const read = selectNativeRead.select(appStore.state, nativeDemand);
    if (read.destinationKey !== original.destinationKey) return false;
    if (!nativeParentClaimed && read.contextKey !== original.contextKey) return false;
    return selectNativeReviewForOwner.select(appStore.state, owner)?.status === 'ready';
  }
  function prepareNativeCommit() {
    const read = selectNativeRead.select(appStore.state, nativeDemand);
    // Input updates the store before its next renderer notification.
    const draft = selectAcceptChangesState.select(appStore.state, workspaceId);
    if (
      nativeIntent ||
      nativeReadChanged ||
      !hasStaged ||
      !nativeBranch.trim() ||
      !nativeMessage.trim() ||
      !draft.prTitle.trim() ||
      read.target?.provider !== 'gitlab' ||
      !read.contextKey ||
      read.contextKey !== nativeReadKey ||
      !read.destinationKey
    )
      return;
    const admission = selectPrincipalActionContext.select(appStore.state);
    const hostContext = selectWorkspaceActionContext.select(appStore.state, workspaceId);
    if (!admission || !hostContext || !isOwner || listOnly) return;
    const owner: NativeReviewOwner = Object.freeze({
      root: Object.freeze({ workspaceId, kind: 'primary' }),
      attemptId: crypto.randomUUID(),
      admission,
      hostContext,
    });
    const intent: NativeSidebarReviewIntent = Object.freeze({
      owner,
      targetBranch: nativeBranch,
      commitMessage: nativeMessage,
      prTitle: draft.prTitle,
      prBody: draft.prDescription,
      contextKey: read.contextKey,
      destinationKey: read.destinationKey,
    });
    nativeIntent = intent;
    backgroundGitActionsService.prepareNativeReview(intent);
  }
  function updateTitle(title: string) {
    const draft = selectAcceptChangesState.select(appStore.state, workspaceId);
    appStore.dispatch(setPRContent(workspaceId, title, draft.prDescription));
  }
  function updateDescription(description: string) {
    const draft = selectAcceptChangesState.select(appStore.state, workspaceId);
    appStore.dispatch(setPRContent(workspaceId, draft.prTitle, description));
  }
  /** The only queue consumer entry: display the original prepared first confirmation. */
  async function triggerNativeReview(intent: NativeSidebarReviewIntent) {
    const original = nativeIntent;
    if (
      !original ||
      original.owner.attemptId !== intent.owner.attemptId ||
      original.owner.admission !== intent.owner.admission ||
      original.owner.hostContext !== intent.owner.hostContext ||
      original.owner.root.workspaceId !== intent.owner.root.workspaceId ||
      intent.owner.root.kind !== 'primary' ||
      original.contextKey !== intent.contextKey ||
      original.commitMessage !== intent.commitMessage ||
      original.prTitle !== intent.prTitle ||
      original.prBody !== intent.prBody ||
      original.targetBranch !== intent.targetBranch ||
      nativeParentClaimed ||
      nativeConfirming ||
      !nativeEligible(original.owner)
    )
      return;
    const view = selectNativeReviewForOwner.select(appStore.state, original.owner);
    if (!view?.preview?.valid) return;
    const prepared = view.preview.reviewPreparation;
    nativeConfirming = original.owner.attemptId;
    try {
      const agreed = await confirm({
        title: m.workspace_commitDrawer_commit_label(),
        description:
          (view.preview.filesCount === 1
            ? m.workspace_commitDrawer_stagedWillCommit_one()
            : m.workspace_commitDrawer_stagedWillCommit_many({
                count: formatInteger(view.preview.filesCount),
              })) +
          '\n' +
          original.commitMessage +
          '\n' +
          prepared.target.repository.projectPath +
          ' (' +
          prepared.target.repository.instanceBaseUrl +
          ')\n' +
          prepared.source.branch +
          ' → ' +
          prepared.target.branch,
        confirmLabel: m.workspace_commitDrawer_commit_label(),
        cancelLabel: m.workspace_prCreator_cancel_label(),
      });
      if (!agreed || nativeParentClaimed || !nativeEligible(original.owner)) return;
      nativeParentClaimed = true;
      appStore.dispatch(
        nativeReviewConfirmRequested(original.owner, { commitMessage: original.commitMessage }),
      );
    } finally {
      if (nativeConfirming === original.owner.attemptId) nativeConfirming = null;
    }
  }
  function prepareNativeChild() {
    const original = nativeIntent;
    if (!original || !nativeCanContinue || nativeChild || !prDrawerOpen) return;
    const child: NativeReviewOwner = Object.freeze({
      ...original.owner,
      attemptId: crypto.randomUUID(),
    });
    nativeChild = child;
    appStore.dispatch(nativeReviewCompanionRequested(original.owner, child));
  }
  async function confirmNativeChild() {
    const original = nativeIntent,
      child = nativeChild;
    if (!original || !child || nativeChildClaimed || nativeConfirming || !nativeEligible(child))
      return;
    const view = selectNativeReviewForOwner.select(appStore.state, child);
    if (!view?.preview?.valid) return;
    const prepared = view.preview.reviewPreparation;
    nativeConfirming = child.attemptId;
    try {
      const agreed = await confirm({
        title: m.native_review_confirm_title(),
        description: m.native_review_confirm_description({
          title: original.prTitle,
          project:
            prepared.target.repository.projectPath +
            ' (' +
            prepared.target.repository.instanceBaseUrl +
            ')',
          source: prepared.source.branch,
          target: prepared.target.branch,
        }),
        confirmLabel: m.workspace_prCreator_create_label(),
        cancelLabel: m.workspace_prCreator_cancel_label(),
      });
      if (!agreed || nativeChildClaimed || !nativeEligible(child)) return;
      nativeChildClaimed = true;
      appStore.dispatch(
        nativeReviewConfirmRequested(child, { prTitle: original.prTitle, prBody: original.prBody }),
      );
    } finally {
      if (nativeConfirming === child.attemptId) nativeConfirming = null;
    }
  }
  function checkNative(owner: NativeReviewOwner) {
    if (nativeChecking || !selectNativeReviewForOwner.select(appStore.state, owner)) return;
    nativeChecking = owner.attemptId;
    appStore.dispatch(nativeReviewReconcileRequested(owner));
  }
  // Resolve the original read before deciding whether a saved named remote has a native entry.
  // Origin-only status is not repository qualification or command permission.
  $effect(() => {
    const originalWorkspace = workspaceId;
    const originalAdmission = nativeAdmission;
    const originalHost = hostOperationContext;
    if (!nativeEntryWithoutOrigin || !originalWorkspace || !originalAdmission || !originalHost)
      return;
    untrack(() => {
      if (!nativeDemand) startNativeRead();
    });
  });
  $effect(() => {
    const read = nativeRead.current;
    if (!nativeDemand) return;
    if (!nativeReadKey && read.contextKey) nativeReadKey = read.contextKey;
    else if (nativeReadKey && read.contextKey !== nativeReadKey) nativeReadChanged = true;
    if (
      nativeIntent &&
      ((nativeParentClaimed &&
        read.view?.status === 'ready' &&
        read.destinationKey !== nativeIntent.destinationKey) ||
        (!nativeParentClaimed && nativeReadChanged))
    )
      endNativeOwners();
  });
  $effect(() => {
    const original = nativeIntent;
    if (
      nativeDemand &&
      (nativeDemand.workspaceId !== workspaceId ||
        nativeDemand.admission !== nativeAdmission ||
        nativeDemandHost !== hostOperationContext ||
        !nativeReview ||
        !nativeEnabled ||
        listOnly ||
        !isOwner)
    )
      closeNative();
    if (
      original &&
      (workspaceId !== original.owner.root.workspaceId ||
        listOnly ||
        original.owner.admission !== nativeAdmission ||
        original.owner.hostContext !== hostOperationContext)
    )
      closeNative();
  });
  $effect(() => {
    if (
      nativeIntent &&
      nativeParentView.current?.status === 'ready' &&
      nativeQueued !== nativeIntent.owner.attemptId &&
      backgroundGitActionsService.enqueueNativeReview(nativeIntent)
    )
      nativeQueued = nativeIntent.owner.attemptId;
  });
  $effect(() => {
    if (nativeParentView.current?.observation || nativeChildView.current?.observation)
      nativeChecking = null;
  });
  onDestroy(() => {
    nativeDestroyed = true;
    try {
      closeNative();
      nativeRetirement?.destroyed();
    } finally {
      nativeRetirement = null;
    }
  });

  return {
    get props() {
      return readProps();
    },
    get hostContext() {
      return hostOperationContext;
    },
    get nativeEnabled() {
      return nativeEnabled;
    },
    get nativeRead() {
      return nativeRead.current;
    },
    get remoteSaving() {
      return readProps().remoteSaving;
    },
    get nativeParentView() {
      return nativeParentView.current;
    },
    get nativeChildView() {
      return nativeChildView.current;
    },
    get nativeIntent() {
      return nativeIntent;
    },
    get nativeChild() {
      return nativeChild;
    },
    get nativeDemand() {
      return nativeDemand;
    },
    get nativeConfirming() {
      return nativeConfirming;
    },
    get nativeReadChanged() {
      return nativeReadChanged;
    },
    get nativeParentClaimed() {
      return nativeParentClaimed;
    },
    get nativeChildClaimed() {
      return nativeChildClaimed;
    },
    get nativeChecking() {
      return nativeChecking;
    },
    get nativeCanContinue() {
      return nativeCanContinue;
    },
    get nativeEntryWithoutOrigin() {
      return nativeEntryWithoutOrigin;
    },
    get nativeMode() {
      return nativeMode;
    },
    get nativeBranch() {
      return nativeBranch;
    },
    set nativeBranch(value: string) {
      nativeBranch = value;
    },
    get nativeMessage() {
      return nativeMessage;
    },
    set nativeMessage(value: string) {
      nativeMessage = value;
    },
    get legacyBlocked() {
      return (
        nativeReview &&
        nativeEnabled &&
        (nativeIntent !== null ||
          selectNativeRead.select(appStore.state, nativeDemand).target?.provider !== 'github')
      );
    },
    observeNativeRetirement,
    triggerNativeReview,
    togglePRDrawer,
    closeNative,
    startNativeRead,
    prepareNativeCommit,
    updateTitle,
    updateDescription,
    endNativeOwners,
    checkNative,
    prepareNativeChild,
    confirmNativeChild,
  };
}
