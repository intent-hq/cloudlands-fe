<script lang="ts">
  /* eslint-disable max-lines -- sibling mode remains in the single shared proposal renderer */
  import { tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCircleCheck, faPencil } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { getSpecialistById } from '$lib/constants/specialists';
  import { DiffViewer } from '$features/file-tracking/components/diff';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import type {
    Proposal,
    ProposalActionDetail,
    ProposalEditableField,
    WorkspaceCreateProposalFields,
    WorkspaceCreateRepoType,
  } from '$shared/types/proposal';
  import {
    isSettingsChangeProposal,
    isSpecialistEditProposal,
    isWorkspaceCreateProposal,
  } from '$shared/types/proposal';
  import BulkProposalItems from './BulkProposalItems.svelte';
  import SettingsChangeCard from './SettingsChangeCard.svelte';
  import SpecialistChangeCard from './SpecialistChangeCard.svelte';
  import { getProposalId } from './proposal-id';
  import type { ProposalCardDraft } from './proposal-tray-storage';
  import { goto } from '$app/navigation';
  import {
    selectProposalError,
    selectProposalErrorCode,
    selectProposalResult,
    selectProposalStatus,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import { invoke } from '$lib/electron-bridge';
  import {
    getPrBranchLookupKey,
    prBranchLookupFailed as prBranchLookupFailedAction,
    prBranchLookupStarted,
    prBranchLookupSucceeded,
  } from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-slice';
  import { selectPrBranchLookupEntries } from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-selectors';
  import type { PrBranchLookupRequest } from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-types';
  import { store as appStore } from '$store/renderer/store';
  import RepoAndBranchPicker from '$lib/components/workspace/initializer/RepoAndBranchPicker.svelte';
  import type { BranchListInfo } from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import SpecialistDropdown from '$lib/components/chat/SpecialistDropdown.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    proposal: Proposal;
    disabled?: boolean;
    onApply?: (detail: ProposalActionDetail) => void;
    onDiscard?: (detail: ProposalActionDetail) => void;
    onUndo?: (proposalId: string) => void;
    /**
     * Tray-hosted restore: transient edits (field values, bulk selections,
     * workspace-create text edits) captured by a previous mount. Applied
     * once at init — later changes to the prop are ignored, so the tray
     * remounts the card (`{#key proposalId}`) to change it.
     */
    initialDraft?: ProposalCardDraft | null;
    /** Reports every transient-edit change so the tray can persist it. */
    onDraftChange?: (draft: ProposalCardDraft) => void;
    /**
     * Tray-hosted Dismiss: skip the local "Discarded" tombstone state so the
     * host can route discard through its own confirm dialog + resolve flow.
     */
    suppressLocalDiscard?: boolean;
  }

  type EditorHandle = {
    focus: () => void;
    setSelectionRange?: (
      start: number,
      end: number,
      direction?: 'forward' | 'backward' | 'none',
    ) => void;
  };

  let {
    proposal,
    disabled = false,
    onApply,
    onDiscard,
    onUndo,
    initialDraft = null,
    onDraftChange,
    suppressLocalDiscard = false,
  }: Props = $props();

  // Captured once at init (tray remounts per proposal via {#key}), so a
  // teardown-frame prop change can never re-overlay stale edits.
  // svelte-ignore state_referenced_locally
  const restoredDraft = initialDraft;

  let rootElement = $state<HTMLElement | undefined>();
  let statusElement = $state<HTMLElement | undefined>();
  let isDismissed = $state(false);
  let fieldValues = $state<Record<string, string>>({});
  // Settings proposals delegate field editing to SettingsChangeCard; its
  // string-serialized enum edits stand in for `fieldValues` in the draft.
  let settingsEditedFields = $state<Record<string, string> | null>(null);
  let selectedBulkItemIds = $state<string[]>([]);
  let editingFieldKey = $state<string | null>(null);
  let draftFieldValue = $state('');
  let activeEditor = $state<EditorHandle | undefined>();
  let syncedWorkspaceProposal: Proposal | undefined;
  let workspaceTitle = $state('');
  let workspaceInitialPrompt = $state('');
  let workspaceShortcutEditorFocused = $state(false);
  let workspaceRepoPath = $state('');
  let workspaceRepoType = $state<WorkspaceCreateRepoType>('local');
  let workspaceGithubUrl = $state('');
  let workspaceClonePath = $state('');
  let workspaceBranch = $state('');
  let workspaceIsNewRepo = $state(false);
  let workspaceIsValidPath = $state(false);
  let workspaceScope = $state('');
  let workspaceSpecialist = $state<string | null>(null);
  let prBranchLookupKey = $state('');
  let prBranchLookupRequest = $state<PrBranchLookupRequest | undefined>();
  let prBranchUserEdited = $state(false);
  let branchRowElement = $state<HTMLElement | undefined>();
  let proposedBranchMissing = $state('');
  let branchListDefault = $state('');
  const BEFORE_AFTER_STACK_THRESHOLD = 40;
  // Cross-render dedup for direct PR-branch lookups; the store's `loading`
  // entry (written synchronously by prBranchLookupStarted) dedups across
  // component instances.
  const prBranchLookupInFlightKeys = new Set<string>();

  const prBranchLookupEntries = selectPrBranchLookupEntries();

  const fields = $derived(proposal.preview.fields ?? []);
  const bulkItems = $derived(proposal.preview.bulkItems ?? []);
  const diff = $derived(proposal.preview.diff);
  const kindLabel = $derived(proposal.kind.replace(/-/g, ' '));
  const proposalId = $derived(getProposalId(proposal));
  const lifecycleStatus = selectProposalStatus(untrack(() => proposalId));
  const lifecycleError = selectProposalError(untrack(() => proposalId));
  const lifecycleErrorCode = selectProposalErrorCode(untrack(() => proposalId));
  const lifecycleResult = selectProposalResult(untrack(() => proposalId));
  const isWorkspaceCreate = $derived(proposal.kind === 'workspace-create');
  const isSiblingWorkspaceCreate = $derived(
    isWorkspaceCreate && proposal.preview.workspaceCreate?.mode === 'sibling',
  );
  const settingsProposal = $derived(isSettingsChangeProposal(proposal) ? proposal : undefined);
  const specialistProposal = $derived(isSpecialistEditProposal(proposal) ? proposal : undefined);
  const shortcutModifier = $derived(
    typeof navigator !== 'undefined' && navigator.userAgent?.includes('Mac') ? '⌘' : 'Ctrl',
  );
  const isApplying = $derived($lifecycleStatus === 'applying');
  const isUndoing = $derived($lifecycleStatus === 'undoing');
  const isFailed = $derived($lifecycleStatus === 'failed');
  const isApplied = $derived($lifecycleStatus === 'applied');
  const showDismissed = $derived(isDismissed);
  const createdWorkspaceId = $derived($lifecycleResult?.workspaceId);
  const isWorkspaceCreated = $derived(isWorkspaceCreate && isApplied);
  const workspaceHeading = $derived(
    isSiblingWorkspaceCreate ? workspaceTitle : proposal.preview.title,
  );
  const createdRepoLabel = $derived.by(() => {
    if (workspaceRepoType === 'github' && workspaceGithubUrl) {
      const ownerRepo = parseGithubOwnerRepo(workspaceGithubUrl);
      return ownerRepo ? `${ownerRepo.owner}/${ownerRepo.repo}` : workspaceGithubUrl;
    }
    return workspaceRepoPath;
  });
  const createdSpecialistLabel = $derived(
    workspaceSpecialist
      ? (getSpecialistById(workspaceSpecialist)?.name ?? workspaceSpecialist)
      : '',
  );
  const statusMessage = $derived(getStatusMessage());
  const prBranchLookup = $derived(
    prBranchLookupKey ? $prBranchLookupEntries[prBranchLookupKey] : undefined,
  );
  const prBranchLoading = $derived(prBranchLookup?.status === 'loading');
  const prBranchLookupFailed = $derived(prBranchLookup?.status === 'failed');
  const isAwaitingPrBranchLookup = $derived(
    isWorkspaceCreate &&
      Boolean(prBranchLookupRequest) &&
      canUseElectronPrLookup() &&
      prBranchLookup?.status !== 'succeeded' &&
      !prBranchLookupFailed,
  );
  // Structured detection first: the daemon marks unresolvable base refs with
  // `error.data.code === "base-ref-unresolvable"` on workspace.create failures
  // (monorepo#761), threaded into the lifecycle slice as `errorCode`. The prose
  // match on "cannot resolve base ref '<ref>'" is kept as a fallback for older
  // daemons that predate the structured code.
  const isBaseRefFailure = $derived(
    isWorkspaceCreate &&
      isFailed &&
      ($lifecycleErrorCode === 'base-ref-unresolvable' ||
        /cannot resolve base ref/i.test($lifecycleError ?? '')),
  );
  const branchNeedsAttention = $derived(Boolean(proposedBranchMissing) || isBaseRefFailure);
  const actionDisabled = $derived(
    disabled || isApplying || isUndoing || isApplied || isAwaitingPrBranchLookup || prBranchLoading,
  );
  const showWorkspaceShortcutHint = $derived(
    isSiblingWorkspaceCreate && workspaceShortcutEditorFocused && !actionDisabled,
  );
  const metadataIdPrefix = $derived(`proposal-${toDomId(proposalId)}`);
  // Tray-hosted: the tray body provides the surface (bg, radius, padding), so
  // the card spans the full width with no border/shadow chrome of its own.
  const cardClass = $derived(isWorkspaceCreate ? 'min-w-0 w-full p-4 sm:p-5' : 'min-w-0 w-full');

  // One-shot restored-draft overlays: consumed on the first run of the
  // matching sync effect so a later proposal identity change (remount-less
  // hosts) resets cleanly from the proposal itself.
  let pendingFieldDraft = restoredDraft;
  let pendingWorkspaceDraft = restoredDraft?.workspace ?? null;

  $effect(() => {
    const defaults = Object.fromEntries(
      fields.map((field) => [field.key, formatValue(getFieldValue(field))]),
    );
    const defaultBulkIds = bulkItems
      .filter((item) => item.selected !== false && !item.disabled)
      .map((item) => item.id);
    if (pendingFieldDraft) {
      const draft = pendingFieldDraft;
      pendingFieldDraft = null;
      const knownKeys = new Set(Object.keys(defaults));
      const knownBulkIds = new Set(bulkItems.map((item) => item.id));
      fieldValues = {
        ...defaults,
        ...Object.fromEntries(
          Object.entries(draft.fieldValues).filter(([key]) => knownKeys.has(key)),
        ),
      };
      selectedBulkItemIds =
        bulkItems.length > 0
          ? draft.selectedBulkItemIds.filter((id) => knownBulkIds.has(id))
          : defaultBulkIds;
      return;
    }
    fieldValues = defaults;
    selectedBulkItemIds = defaultBulkIds;
  });

  // Report transient edits to a tray host so they survive unmount/reload.
  // The first run only captures the initial (possibly restored) snapshot.
  // Settings proposals report the child card's enum edits in place of the
  // outer card's (unused) fieldValues.
  let draftReportPrimed = false;
  $effect(() => {
    const snapshot: ProposalCardDraft = {
      fieldValues: settingsProposal
        ? { ...(settingsEditedFields ?? restoredDraft?.fieldValues ?? {}) }
        : { ...fieldValues },
      selectedBulkItemIds: [...selectedBulkItemIds],
      ...(isWorkspaceCreate
        ? {
            workspace: {
              title: workspaceTitle,
              initialPrompt: workspaceInitialPrompt,
              branch: workspaceBranch,
              specialist: workspaceSpecialist,
            },
          }
        : {}),
    };
    if (!draftReportPrimed) {
      draftReportPrimed = true;
      return;
    }
    onDraftChange?.(snapshot);
  });

  $effect(() => {
    if (!statusMessage || isBaseRefFailure) return;
    void tick().then(() => statusElement?.focus());
  });

  // On a base-ref apply failure, direct attention at the Base branch field
  // instead of the status line — Retry alone can never succeed here.
  $effect(() => {
    if (!isBaseRefFailure) return;
    void tick().then(() => branchRowElement?.focus());
  });

  $effect(() => {
    if (!isWorkspaceCreate || syncedWorkspaceProposal === proposal) return;
    syncedWorkspaceProposal = proposal;
    const workspaceCreate = getWorkspaceCreateFields();
    workspaceTitle = workspaceCreate.title ?? '';
    workspaceInitialPrompt = workspaceCreate.initialPrompt ?? '';
    workspaceShortcutEditorFocused = false;
    workspaceRepoPath = workspaceCreate.repoPath ?? '';
    workspaceRepoType = workspaceCreate.repoType ?? 'local';
    workspaceGithubUrl = workspaceCreate.githubUrl ?? '';
    workspaceClonePath = workspaceCreate.clonePath ?? '';
    workspaceBranch = workspaceCreate.branch ?? '';
    workspaceIsNewRepo = workspaceCreate.isNewRepo ?? false;
    workspaceIsValidPath = workspaceCreate.isValidPath ?? false;
    workspaceScope = workspaceCreate.scope ?? '';
    workspaceSpecialist = workspaceCreate.specialist ?? null;
    prBranchUserEdited = false;
    prBranchLookupKey = '';
    prBranchLookupRequest = undefined;
    proposedBranchMissing = '';
    branchListDefault = '';
    if (pendingWorkspaceDraft) {
      const draft = pendingWorkspaceDraft;
      pendingWorkspaceDraft = null;
      workspaceTitle = draft.title;
      workspaceInitialPrompt = draft.initialPrompt;
      workspaceSpecialist = draft.specialist;
      if (draft.branch && draft.branch !== workspaceBranch) {
        // Restored user-chosen branch: suppress the PR-head lookup override.
        workspaceBranch = draft.branch;
        prBranchUserEdited = true;
      }
    }
  });

  $effect(() => {
    if (!isWorkspaceCreate) {
      prBranchLookupKey = '';
      prBranchLookupRequest = undefined;
      return;
    }

    const { githubUrl, prNumber } = getWorkspaceCreateFields();
    const ownerRepo = parseGithubOwnerRepo(githubUrl);
    if (!ownerRepo || !prNumber || prBranchUserEdited || workspaceBranch !== 'main') {
      prBranchLookupKey = '';
      prBranchLookupRequest = undefined;
      return;
    }

    const lookupKey = `${ownerRepo.owner}/${ownerRepo.repo}#${prNumber}`;
    prBranchLookupKey = lookupKey;
    prBranchLookupRequest = { owner: ownerRepo.owner, repo: ownerRepo.repo, prNumber };
  });

  $effect(() => {
    if (!prBranchLookupRequest || !prBranchLookupKey || prBranchLookup) return;
    if (!canUseElectronPrLookup()) return;

    void performPrBranchLookup(prBranchLookupRequest);
  });

  $effect(() => {
    const branch = prBranchLookup?.status === 'succeeded' ? prBranchLookup.branch?.trim() : '';
    if (!branch || prBranchUserEdited || workspaceBranch !== 'main') return;

    workspaceBranch = branch;
    // The PR head branch replaces any default we preselected, so a
    // missing-branch warning claiming "using default" would now be stale.
    proposedBranchMissing = '';
  });

  function getFieldValue(field: ProposalEditableField): unknown {
    return (
      field.value ?? field.after ?? (proposal.payload as Record<string, unknown>)[field.key] ?? ''
    );
  }

  function getPayloadParams(): Record<string, unknown> {
    if (!isWorkspaceCreateProposal(proposal)) return {};
    const params = proposal.payload.params;
    return params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  }

  function getFieldString(key: string): string | undefined {
    const field = fields.find((item) => item.key === key);
    const value = field ? getFieldValue(field) : undefined;
    return typeof value === 'string' ? value : undefined;
  }

  function getInitialAgentValue(key: string): unknown {
    const initialAgent = getPayloadParams().initialAgent;
    return initialAgent && typeof initialAgent === 'object'
      ? (initialAgent as Record<string, unknown>)[key]
      : undefined;
  }

  const GITHUB_OWNER_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

  function normalizeGithubRepository(repoInput: string): string | undefined {
    const trimmed = repoInput.trim().replace(/\.git$/, '');
    if (GITHUB_OWNER_REPO_PATTERN.test(trimmed)) return `https://github.com/${trimmed}`;

    if (/^https?:\/\/github\.com\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        const [owner, repo] = url.pathname.split('/').filter(Boolean);
        if (owner && repo) return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
      } catch {
        return undefined;
      }
    }

    if (/^git@github\.com:/i.test(trimmed)) {
      const [owner, repo] = trimmed.replace(/^git@github\.com:/i, '').split('/');
      if (owner && repo) return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`;
    }

    return undefined;
  }

  function repositoryFallbackPath(repoInput: string, githubUrl?: string): string | undefined {
    if (githubUrl) return undefined;
    const trimmed = repoInput.trim();
    if (!trimmed) return undefined;
    if (/^(~|\.\/|\/|[a-zA-Z]:[\\/])/.test(trimmed)) return trimmed;
    if (!trimmed.includes('/')) return trimmed;
    return undefined;
  }

  function repositoryOwnerNameToGithubUrl(owner?: string, name?: string): string | undefined {
    if (!owner || !name) return undefined;
    return `https://github.com/${owner}/${name.replace(/\.git$/, '')}`;
  }

  function parseGithubPrUrl(prUrl?: string):
    | {
        githubUrl: string;
        prNumber: number;
      }
    | undefined {
    if (!prUrl) return undefined;
    try {
      const url = new URL(prUrl.trim());
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com')
        return undefined;
      const [owner, repo, segment, number] = url.pathname.split('/').filter(Boolean);
      if (!owner || !repo || segment !== 'pull') return undefined;
      const prNumber = Number(number);
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0) return undefined;
      return { githubUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`, prNumber };
    } catch {
      return undefined;
    }
  }

  function parseGithubOwnerRepo(githubUrl?: string): { owner: string; repo: string } | undefined {
    const stripped = githubUrl
      ?.trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '');
    if (!stripped) return undefined;
    const [owner, repo] = stripped.split('/').filter(Boolean);
    return owner && repo ? { owner, repo } : undefined;
  }

  function canUseElectronPrLookup(): boolean {
    if (typeof window === 'undefined' || !window.electronAPI) return false;
    return window.electronAPI.versions?.electron !== '0.0.0-browser';
  }

  async function performPrBranchLookup(request: PrBranchLookupRequest): Promise<void> {
    const payload = { ...request, key: getPrBranchLookupKey(request) };
    if (prBranchLookupInFlightKeys.has(payload.key)) return;

    prBranchLookupInFlightKeys.add(payload.key);
    appStore.dispatch(prBranchLookupStarted(payload));

    try {
      const response = await invoke<{
        success: boolean;
        data?: { sourceBranch?: string };
        error?: string;
      }>('git-tracking:get-pull-request', {
        owner: payload.owner,
        repo: payload.repo,
        number: payload.prNumber,
      });
      const branch = response?.success ? response.data?.sourceBranch?.trim() : undefined;

      if (branch) {
        appStore.dispatch(prBranchLookupSucceeded(payload, branch));
        return;
      }

      appStore.dispatch(
        // i18n-ignore — internal store error string, never rendered directly
        prBranchLookupFailedAction(payload, response?.error ?? 'Could not detect PR branch'),
      );
    } catch (error) {
      appStore.dispatch(
        prBranchLookupFailedAction(
          payload,
          // i18n-ignore — internal store error string, never rendered directly
          error instanceof Error ? error.message : 'PR branch lookup failed',
        ),
      );
    } finally {
      prBranchLookupInFlightKeys.delete(payload.key);
    }
  }

  function toDomId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
  }

  function stringParam(key: string): string | undefined {
    const value = getPayloadParams()[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  function getWorkspaceCreateFields(): WorkspaceCreateProposalFields {
    const params = getPayloadParams();
    const preview = proposal.preview.workspaceCreate ?? {};
    const repoInput = stringParam('repository');
    const fallbackGithubUrl = repoInput ? normalizeGithubRepository(repoInput) : undefined;
    const ownerNameGithubUrl = repositoryOwnerNameToGithubUrl(
      stringParam('repositoryOwner'),
      stringParam('repositoryName'),
    );
    const parsedPr = parseGithubPrUrl(stringParam('prUrl'));
    const githubUrl =
      preview.githubUrl ??
      stringParam('githubUrl') ??
      getFieldString('githubUrl') ??
      fallbackGithubUrl ??
      ownerNameGithubUrl ??
      parsedPr?.githubUrl;
    const repoPath =
      preview.repoPath ??
      stringParam('repoPath') ??
      stringParam('repositoryPath') ??
      getFieldString('repositoryPath') ??
      (repoInput ? repositoryFallbackPath(repoInput, githubUrl) : undefined);
    return {
      mode: preview.mode,
      title: preview.title ?? stringParam('title'),
      initialPrompt:
        preview.initialPrompt ??
        (typeof getInitialAgentValue('prompt') === 'string'
          ? (getInitialAgentValue('prompt') as string)
          : (stringParam('initialMessage') ??
            stringParam('prompt') ??
            getFieldString('initialPrompt'))),
      repoPath,
      repoType: githubUrl
        ? 'github'
        : (preview.repoType ?? (params.environmentConfig ? 'remote' : 'local')),
      githubUrl,
      prNumber: preview.prNumber ?? parsedPr?.prNumber,
      clonePath: preview.clonePath ?? stringParam('clonePath') ?? '',
      branch:
        preview.branch ??
        stringParam('branch') ??
        stringParam('baseRef') ??
        getFieldString('branch') ??
        'main',
      isNewRepo:
        preview.isNewRepo ?? (typeof params.isNewRepo === 'boolean' ? params.isNewRepo : false),
      isValidPath:
        preview.isValidPath ??
        (typeof params.isValidPath === 'boolean' ? params.isValidPath : false),
      scope: preview.scope ?? stringParam('scope') ?? '',
      specialist:
        'specialist' in preview
          ? preview.specialist
          : typeof getInitialAgentValue('specialist') === 'string'
            ? (getInitialAgentValue('specialist') as string)
            : (stringParam('specialist') ?? null),
    };
  }

  function formatValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  function getEmptyFieldLabel(field: ProposalEditableField): string {
    if (field.editable !== false && field.key === 'title')
      return m.chat_proposalCard_addTitle_placeholder();
    return field.editable !== false ? m.chat_proposalCard_notSet_label() : '—';
  }

  function isMultilineEditor(field: ProposalEditableField): boolean {
    return field.multiline === true;
  }

  function isFieldEditable(field: ProposalEditableField): boolean {
    return field.editable !== false && !actionDisabled;
  }

  function getEditableValue(field: ProposalEditableField): string {
    return fieldValues[field.key] ?? formatValue(getFieldValue(field));
  }

  function getAfterDisplayValue(field: ProposalEditableField): string {
    return getEditableValue(field);
  }

  function shouldStackBeforeAfter(field: ProposalEditableField): boolean {
    return [formatValue(field.before), getAfterDisplayValue(field)].some(
      (value) => value.length > BEFORE_AFTER_STACK_THRESHOLD || value.includes('\n'),
    );
  }

  function getFieldDisplayValue(field: ProposalEditableField): string {
    return getEditableValue(field);
  }

  async function startEditing(field: ProposalEditableField) {
    if (!isFieldEditable(field)) return;
    editingFieldKey = field.key;
    draftFieldValue = getEditableValue(field);
    await tick();
    activeEditor?.focus();
    await tick();
    if (typeof document === 'undefined') return;
    const element = document.activeElement;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const end = element.value.length;
      element.setSelectionRange(end, end);
    }
  }

  function commitEditing(field: ProposalEditableField) {
    if (editingFieldKey !== field.key) return;
    fieldValues = { ...fieldValues, [field.key]: draftFieldValue };
    editingFieldKey = null;
    draftFieldValue = '';
    activeEditor = undefined;
  }

  function cancelEditing(field: ProposalEditableField) {
    if (editingFieldKey !== field.key) return;
    editingFieldKey = null;
    draftFieldValue = '';
    activeEditor = undefined;
  }

  function handleEditableKeydown(event: KeyboardEvent, field: ProposalEditableField) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void startEditing(field);
  }

  function handleEditorKeydown(event: KeyboardEvent, field: ProposalEditableField) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing(field);
      return;
    }
    if (event.key !== 'Enter') return;
    if (isMultilineEditor(field) && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    commitEditing(field);
  }

  function handleRepoChange(
    event: CustomEvent<{
      path: string;
      type: WorkspaceCreateRepoType;
      githubUrl?: string;
      clonePath?: string;
      isNewRepo?: boolean;
      isValidPath?: boolean;
      scope?: string;
    }>,
  ) {
    workspaceRepoPath = event.detail.path;
    workspaceRepoType = event.detail.type;
    workspaceGithubUrl = event.detail.githubUrl ?? '';
    workspaceClonePath = event.detail.clonePath ?? '';
    workspaceIsNewRepo = event.detail.isNewRepo ?? false;
    workspaceIsValidPath = event.detail.isValidPath ?? false;
    workspaceScope = event.detail.scope ?? '';
    workspaceBranch = workspaceIsNewRepo ? 'main' : '';
    proposedBranchMissing = '';
    branchListDefault = '';
  }

  function handleBranchChange(event: CustomEvent<{ branch: string }>) {
    prBranchUserEdited = true;
    prBranchLookupKey = '';
    prBranchLookupRequest = undefined;
    proposedBranchMissing = '';
    workspaceBranch = event.detail.branch;
  }

  function handleBranchesLoaded(info: BranchListInfo) {
    if (!isWorkspaceCreate || workspaceIsNewRepo) return;
    if (info.branches.length === 0 && info.remoteBranches.length === 0) return;
    branchListDefault = info.defaultBranch;
    const known = new Set([...info.branches, ...info.remoteBranches]);
    if (workspaceBranch && !known.has(workspaceBranch)) {
      // The proposed base branch doesn't exist in this repo: warn (keeping the
      // proposed name visible) and preselect the repo's default branch. Apply
      // is never blocked — the daemon stays the enforcement point.
      proposedBranchMissing = workspaceBranch;
      if (info.defaultBranch) workspaceBranch = info.defaultBranch;
    } else {
      proposedBranchMissing = '';
    }
  }

  function addPopulatedField(
    editedFields: Record<string, unknown>,
    key: keyof WorkspaceCreateProposalFields,
    value: unknown,
  ) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) editedFields[key] = trimmed;
      return;
    }
    if (value !== undefined) editedFields[key] = value;
  }

  function buildWorkspaceEditedFields(): Record<string, unknown> {
    const editedFields: Record<string, unknown> = {};
    if (isSiblingWorkspaceCreate) editedFields.title = workspaceTitle.trim();
    addPopulatedField(editedFields, 'initialPrompt', workspaceInitialPrompt);
    if (!isSiblingWorkspaceCreate) {
      addPopulatedField(editedFields, 'repoPath', workspaceRepoPath);
      addPopulatedField(editedFields, 'repoType', workspaceRepoType);
      addPopulatedField(editedFields, 'githubUrl', workspaceGithubUrl);
      addPopulatedField(editedFields, 'clonePath', workspaceClonePath);
      addPopulatedField(editedFields, 'isNewRepo', workspaceIsNewRepo);
      addPopulatedField(editedFields, 'isValidPath', workspaceIsValidPath);
      addPopulatedField(editedFields, 'scope', workspaceScope);
    }
    addPopulatedField(editedFields, 'branch', workspaceBranch);
    addPopulatedField(editedFields, 'specialist', workspaceSpecialist);
    return editedFields;
  }

  function handleCardKeydown(event: KeyboardEvent) {
    if (!isWorkspaceCreate || disabled || isWorkspaceCreated) return;
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    handleApply();
  }

  function handleWorkspaceEditorFocus() {
    if (isSiblingWorkspaceCreate && !actionDisabled) workspaceShortcutEditorFocused = true;
  }

  function handleWorkspaceEditorBlur(event: FocusEvent) {
    const nextElement = event.relatedTarget;
    if (
      nextElement instanceof HTMLElement &&
      nextElement.hasAttribute('data-workspace-shortcut-editor')
    ) {
      return;
    }
    workspaceShortcutEditorFocused = false;
  }

  function cardKeyboardShortcut(node: HTMLElement) {
    node.addEventListener('keydown', handleCardKeydown);
    return {
      destroy() {
        node.removeEventListener('keydown', handleCardKeydown);
      },
    };
  }

  function buildDetail(): ProposalActionDetail {
    return {
      proposal,
      editedFields: isWorkspaceCreate ? buildWorkspaceEditedFields() : fieldValues,
      selectedBulkItemIds,
    };
  }

  function emitAction(name: string, detail: ProposalActionDetail) {
    rootElement?.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  function getStatusMessage(): string {
    // Workspace-create gets neutral, user-facing wording — the user shouldn't see
    // internal "proposal" terminology, and the success state is signalled by the
    // "Open workspace" link rather than a status line.
    if (isWorkspaceCreate) {
      if (isAwaitingPrBranchLookup) return m.chat_proposalCard_detectingPrBranch_label();
      if (isApplying) return m.chat_proposalCard_creatingWorkspace_label();
      if (isFailed) {
        const message = `${m.chat_proposalCard_workspaceCreationFailed_label()}${$lifecycleError ? `: ${$lifecycleError}` : ''}`;
        return isBaseRefFailure
          ? `${message}${m.chat_proposalCard_chooseDifferentBranch_label()}`
          : message;
      }
      return '';
    }
    if (isApplying) return m.chat_shared_applying_label();
    if (isUndoing) return m.chat_shared_undoing_label();
    if (isFailed)
      return `${m.chat_shared_actionFailed_label()}${$lifecycleError ? `: ${$lifecycleError}` : ''}`;
    if (isApplied) return m.chat_shared_appliedStatus_label();
    return '';
  }

  function handleApply() {
    if (actionDisabled) return;
    const detail = buildDetail();
    onApply?.(detail);
    emitAction('proposalapply', detail);
  }

  function handleDiscard() {
    if (actionDisabled) return;
    const detail = buildDetail();
    if (!suppressLocalDiscard) isDismissed = true;
    onDiscard?.(detail);
    emitAction('proposaldiscard', detail);
  }

  async function handleOpenCreatedWorkspace(event: MouseEvent) {
    if (!createdWorkspaceId) return;
    event.preventDefault();
    await goto(`/workspace/${createdWorkspaceId}`);
  }
</script>

{#if showDismissed}
  <div class="type-body px-3 py-2 text-muted-foreground">
    {m.chat_shared_discarded_label()}
    {proposal.preview.title}
  </div>
{:else if settingsProposal}
  <SettingsChangeCard
    proposal={settingsProposal}
    {disabled}
    {onApply}
    {onDiscard}
    {onUndo}
    {suppressLocalDiscard}
    initialEditedFields={restoredDraft?.fieldValues ?? null}
    onEditedFieldsChange={(fields) => (settingsEditedFields = fields)}
  />
{:else if specialistProposal}
  <SpecialistChangeCard
    proposal={specialistProposal}
    {disabled}
    {onApply}
    {onDiscard}
    {onUndo}
    {suppressLocalDiscard}
  />
{:else}
  <section
    bind:this={rootElement}
    class={cardClass}
    data-proposal-kind={proposal.kind}
    data-lifecycle-status={$lifecycleStatus}
    data-apply-tool-call-id={proposal.applyToolCallId}
    title={proposal.applyToolCallId
      ? m.chat_shared_tool_title({ id: proposal.applyToolCallId })
      : undefined}
    use:cardKeyboardShortcut
  >
    {#if isWorkspaceCreate}
      {#if isWorkspaceCreated}
        <div class="space-y-3" data-state="workspace-created">
          <div class="flex items-start gap-2">
            <span aria-hidden="true" class="mt-0.5 flex shrink-0 items-center">
              <Fa icon={faCircleCheck} class="h-4 w-4 text-success" />
            </span>
            <h3 class="type-body min-w-0 font-medium leading-snug text-foreground">
              {workspaceHeading}
            </h3>
          </div>

          {#if workspaceInitialPrompt}
            <p class="type-body line-clamp-3 whitespace-pre-wrap text-muted-foreground">
              {workspaceInitialPrompt}
            </p>
          {/if}

          <dl class="type-caption space-y-1">
            {#if createdRepoLabel}
              <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
                <dt class="text-muted-foreground">{m.chat_proposalCard_repo_label()}</dt>
                <dd class="min-w-0 truncate text-foreground">{createdRepoLabel}</dd>
              </div>
            {/if}
            {#if workspaceBranch}
              <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
                <dt class="text-muted-foreground">{m.chat_proposalCard_baseBranch_label()}</dt>
                <dd class="min-w-0 truncate text-foreground">{workspaceBranch}</dd>
              </div>
            {/if}
            {#if createdSpecialistLabel}
              <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
                <dt class="text-muted-foreground">{m.chat_proposalCard_specialist_label()}</dt>
                <dd class="min-w-0 truncate text-foreground">{createdSpecialistLabel}</dd>
              </div>
            {/if}
          </dl>

          <div class="flex items-center justify-end pt-1">
            {#if createdWorkspaceId}
              <a
                href={`/workspace/${createdWorkspaceId}`}
                onclick={handleOpenCreatedWorkspace}
                data-testid="proposal-open-created-workspace"
                class="inline-flex"
              >
                <Button size="sm">{m.chat_proposalCard_openWorkspace_label()}</Button>
              </a>
            {:else}
              <span
                class="type-caption text-muted-foreground"
                data-testid="proposal-workspace-created"
                >{m.chat_proposalCard_workspaceCreated_label()}</span
              >
            {/if}
          </div>
        </div>
      {:else}
        <div class="space-y-4">
          {#if isSiblingWorkspaceCreate}
            <div class="space-y-2">
              <h3 class="type-body font-medium leading-snug text-foreground">
                {m.chat_proposalCard_createNewWorkspace_title()}
              </h3>
              <Input
                bind:value={workspaceTitle}
                aria-label={m.workspace_page_space_title()}
                placeholder={m.ui_editableName_placeholder()}
                maxlength={100}
                disabled={actionDisabled}
                data-testid="proposal-workspace-title"
                data-workspace-shortcut-editor
                class="font-medium"
                onfocus={handleWorkspaceEditorFocus}
                onblur={handleWorkspaceEditorBlur}
              />
            </div>
          {:else}
            <h3 class="type-body font-medium leading-snug text-foreground">
              {proposal.preview.title}
            </h3>
          {/if}

          <Textarea
            bind:value={workspaceInitialPrompt}
            placeholder={m.chat_proposalCard_initialPrompt_placeholder()}
            minHeight={112}
            maxHeight={240}
            doesExpandToFit
            noFocusStyle
            disabled={actionDisabled}
            data-workspace-shortcut-editor={isSiblingWorkspaceCreate ? '' : undefined}
            class="resize-y"
            onfocus={handleWorkspaceEditorFocus}
            onblur={handleWorkspaceEditorBlur}
          />

          <div class="space-y-1.5">
            <div
              class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2"
              data-row="metadata"
              role="group"
              aria-labelledby={`${metadataIdPrefix}-repo-label`}
            >
              <span
                id={`${metadataIdPrefix}-repo-label`}
                class="type-caption font-medium text-muted-foreground"
                data-metadata-label
              >
                {m.chat_proposalCard_repo_label()}
              </span>
              {#if isSiblingWorkspaceCreate}
                <div
                  class="min-w-0 truncate rounded-md bg-muted/40 px-2 py-1 text-sm leading-5 font-normal text-foreground"
                  data-testid="proposal-repo-locked"
                  title={createdRepoLabel}
                >
                  {createdRepoLabel}
                </div>
              {:else}
                <div class="min-w-0" data-testid="proposal-repo-picker">
                  <RepoAndBranchPicker
                    repoPath={workspaceRepoPath}
                    repoType={workspaceRepoType}
                    githubUrl={workspaceGithubUrl}
                    isNewRepo={workspaceIsNewRepo}
                    presentation="metadata"
                    field="repo"
                    onRepoChange={handleRepoChange}
                  />
                </div>
              {/if}
            </div>

            <div
              class="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-2"
              data-row="metadata"
              role="group"
              aria-labelledby={`${metadataIdPrefix}-branch-label`}
            >
              <span
                id={`${metadataIdPrefix}-branch-label`}
                class="type-caption pt-1 font-medium text-muted-foreground"
                data-metadata-label
              >
                {m.chat_proposalCard_baseBranch_label()}
              </span>
              <div class="min-w-0 space-y-1">
                <div
                  bind:this={branchRowElement}
                  class={branchNeedsAttention
                    ? 'min-w-0 rounded-md ring-1 ring-amber-500/70 focus:outline-none'
                    : 'min-w-0 focus:outline-none'}
                  data-testid="proposal-branch-picker"
                  data-branch-warning={branchNeedsAttention ? 'true' : undefined}
                  tabindex="-1"
                  role="group"
                  aria-label={m.chat_proposalCard_baseBranch_label()}
                  aria-describedby={proposedBranchMissing
                    ? `${metadataIdPrefix}-branch-mismatch`
                    : undefined}
                >
                  <RepoAndBranchPicker
                    repoPath={workspaceRepoPath}
                    branch={workspaceBranch}
                    repoType={workspaceRepoType}
                    githubUrl={workspaceGithubUrl}
                    presentation="metadata"
                    field="branch"
                    isLoading={prBranchLoading}
                    onBranchChange={handleBranchChange}
                    onBranchesLoaded={handleBranchesLoaded}
                  />
                </div>
                {#if proposedBranchMissing}
                  <p
                    id={`${metadataIdPrefix}-branch-mismatch`}
                    class="px-2 text-xs text-amber-600 dark:text-amber-400"
                    data-testid="proposal-branch-mismatch-warning"
                  >
                    {m.chat_proposalCard_branchNotFound_label({
                      branch: proposedBranchMissing,
                    })}{#if branchListDefault}&nbsp;{m.chat_proposalCard_usingDefault_label({
                        branch: branchListDefault,
                      })}{/if}.
                  </p>
                {/if}
                {#if prBranchLookupFailed}
                  <p
                    class="type-caption px-2 text-muted-foreground"
                    data-testid="proposal-branch-lookup-failure"
                  >
                    {m.chat_proposalCard_branchLookupFailed_label()}
                  </p>
                {/if}
              </div>
            </div>

            <div
              class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-2"
              data-row="metadata"
              data-testid="proposal-specialist-dropdown"
              role="group"
              aria-labelledby={`${metadataIdPrefix}-specialist-label`}
            >
              <span
                id={`${metadataIdPrefix}-specialist-label`}
                class="type-caption font-medium text-muted-foreground"
                data-metadata-label
              >
                {m.chat_proposalCard_specialist_label()}
              </span>
              <SpecialistDropdown
                value={workspaceSpecialist}
                variant="bare"
                class="w-full"
                onchange={(id) => {
                  workspaceSpecialist = id;
                }}
              />
            </div>
          </div>

          {#if proposal.preview.warnings?.length}
            <div class="type-caption text-warning">
              {#each proposal.preview.warnings as warning}
                <div>⚠ {warning}</div>
              {/each}
            </div>
          {/if}

          {#if statusMessage}
            <div
              bind:this={statusElement}
              class={isFailed
                ? 'type-caption text-error-foreground focus:outline-none'
                : 'type-caption text-muted-foreground focus:outline-none'}
              role="status"
              aria-live={isFailed ? 'assertive' : 'polite'}
              tabindex="-1"
            >
              {statusMessage}
            </div>
          {/if}

          <div class="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleDiscard}
              >{m.chat_shared_discard_label()}</Button
            >
            <Button
              size="sm"
              disabled={actionDisabled}
              onclick={handleApply}
              aria-keyshortcuts="Enter"
            >
              <span>
                {isAwaitingPrBranchLookup
                  ? m.chat_proposalCard_detectingBranch_label()
                  : isApplying
                    ? m.chat_shared_applying_label()
                    : isFailed
                      ? m.chat_shared_retry_label()
                      : m.chat_proposalCard_createWorkspace_label()}
              </span>
              {#if isSiblingWorkspaceCreate ? showWorkspaceShortcutHint : !isApplying && !isFailed}
                <span class="opacity-50">{shortcutModifier}+↵</span>
              {/if}
            </Button>
          </div>
        </div>
      {/if}
    {:else}
      <div class="px-3 pt-3">
        <div class="min-w-0 space-y-0.5">
          <div class="type-caption font-medium uppercase tracking-wide text-muted-foreground">
            {kindLabel}
          </div>
          <h3 class="type-body font-medium leading-snug text-foreground">
            {proposal.preview.title}
          </h3>
          {#if proposal.preview.summary}
            <p class="type-body leading-relaxed text-muted-foreground">
              {proposal.preview.summary}
            </p>
          {/if}
        </div>
      </div>

      <div class="space-y-3 px-3 py-2.5">
        {#if fields.length > 0}
          <div class="space-y-1.5">
            {#each fields as field (field.key)}
              <div class="field-row" data-proposal-field={field.key}>
                {#if field.before !== undefined || field.after !== undefined}
                  <div class="type-caption mb-1 font-medium text-muted-foreground">
                    {field.label}
                  </div>
                  <div
                    class={shouldStackBeforeAfter(field)
                      ? 'type-body flex flex-col gap-1.5'
                      : 'type-body flex min-w-0 items-center gap-2'}
                    data-proposal-before-after-row={field.key}
                  >
                    <div
                      class="min-w-0 rounded-(--radius-small) border border-border bg-muted/30 px-2 py-1.5 text-muted-foreground"
                    >
                      <span class="sr-only">{m.chat_shared_before_label()} </span>
                      <div class="whitespace-pre-wrap break-words line-through">
                        {formatValue(field.before) || '—'}
                      </div>
                    </div>
                    <div
                      class="shrink-0 px-1 text-muted-foreground"
                      data-proposal-before-after-arrow
                      aria-hidden="true"
                    >
                      →
                    </div>
                    {#if editingFieldKey === field.key}
                      <div class="min-w-0 flex-1 rounded-(--radius-small) text-foreground">
                        <span class="sr-only">{m.chat_shared_after_label()} </span>
                        {#if field.multiline}
                          <Textarea
                            bind:this={activeEditor}
                            bind:value={draftFieldValue}
                            minHeight={72}
                            noFocusStyle
                            onblur={() => commitEditing(field)}
                            onkeydown={(event) => handleEditorKeydown(event, field)}
                          />
                        {:else}
                          <Input
                            bind:this={activeEditor}
                            bind:value={draftFieldValue}
                            noFocusStyle
                            onblur={() => commitEditing(field)}
                            onkeydown={(event) => handleEditorKeydown(event, field)}
                          />
                        {/if}
                      </div>
                    {:else if isFieldEditable(field)}
                      <div
                        class="group min-w-0 flex-1 rounded-(--radius-small) border border-transparent px-2 py-1.5 text-foreground transition-[border-color,background-color,box-shadow] duration-(--motion-fast) hover:border-border hover:bg-accent/60 focus-visible:border-ring focus-visible:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
                        data-proposal-field-value={field.key}
                        role="button"
                        tabindex="0"
                        aria-label={m.chat_proposalCard_editField_ariaLabel({ label: field.label })}
                        onclick={() => void startEditing(field)}
                        onkeydown={(event) => handleEditableKeydown(event, field)}
                      >
                        <span class="sr-only">{m.chat_shared_after_label()} </span>
                        <div
                          class="flex cursor-text items-start gap-1.5 whitespace-pre-wrap break-words"
                        >
                          <span class="min-w-0 flex-1">
                            {#if getAfterDisplayValue(field)}
                              {getAfterDisplayValue(field)}
                            {:else}
                              <span class="text-muted-foreground">{getEmptyFieldLabel(field)}</span>
                            {/if}
                          </span>
                          <Fa
                            icon={faPencil}
                            size="xs"
                            class="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-70 group-focus-visible:opacity-70 motion-reduce:transition-none"
                          />
                        </div>
                      </div>
                    {:else}
                      <div
                        class="min-w-0 flex-1 rounded-(--radius-small) border border-border bg-background px-2 py-1.5 text-foreground"
                        data-proposal-field-value={field.key}
                      >
                        <span class="sr-only">{m.chat_shared_after_label()} </span>
                        <div class="whitespace-pre-wrap break-words">
                          {#if getAfterDisplayValue(field)}
                            {getAfterDisplayValue(field)}
                          {:else}
                            {getEmptyFieldLabel(field)}
                          {/if}
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else if editingFieldKey === field.key}
                  <div>
                    <div class="type-caption mb-1 font-medium text-muted-foreground">
                      {field.label}
                    </div>
                    {#if field.multiline}
                      <Textarea
                        bind:this={activeEditor}
                        bind:value={draftFieldValue}
                        minHeight={72}
                        noFocusStyle
                        onblur={() => commitEditing(field)}
                        onkeydown={(event) => handleEditorKeydown(event, field)}
                      />
                    {:else}
                      <Input
                        bind:this={activeEditor}
                        bind:value={draftFieldValue}
                        noFocusStyle
                        onblur={() => commitEditing(field)}
                        onkeydown={(event) => handleEditorKeydown(event, field)}
                      />
                    {/if}
                  </div>
                {:else if isFieldEditable(field)}
                  <div
                    class="group rounded-(--radius-small) border border-transparent px-2 py-1.5 transition-[border-color,background-color,box-shadow] duration-(--motion-fast) hover:border-border hover:bg-accent/60 focus-visible:border-ring focus-visible:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
                    data-proposal-field-value={field.key}
                    role="button"
                    tabindex="0"
                    aria-label={m.chat_proposalCard_editField_ariaLabel({ label: field.label })}
                    onclick={() => void startEditing(field)}
                    onkeydown={(event) => handleEditableKeydown(event, field)}
                  >
                    <div class="type-caption font-medium text-muted-foreground">{field.label}</div>
                    <div
                      class="type-body flex cursor-text items-start gap-1.5 whitespace-pre-wrap break-words text-foreground"
                    >
                      <span class="min-w-0 flex-1">
                        {#if getFieldDisplayValue(field)}
                          {getFieldDisplayValue(field)}
                        {:else}
                          <span class="text-muted-foreground">{getEmptyFieldLabel(field)}</span>
                        {/if}
                      </span>
                      <Fa
                        icon={faPencil}
                        size="xs"
                        class="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-70 group-focus-visible:opacity-70 motion-reduce:transition-none"
                      />
                    </div>
                  </div>
                {:else}
                  <div data-proposal-field-value={field.key}>
                    <div class="type-caption mb-1 font-medium text-muted-foreground">
                      {field.label}
                    </div>
                    <div class="type-body whitespace-pre-wrap break-words text-foreground">
                      {#if getFieldDisplayValue(field)}
                        {getFieldDisplayValue(field)}
                      {:else}
                        {getEmptyFieldLabel(field)}
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if diff}
          <div class="overflow-hidden rounded-(--radius-medium) border border-border">
            {#if diff.patch}
              <DiffViewer
                patch={diff.patch}
                fileName={diff.fileName ?? m.chat_proposalCard_proposalFile_fallback()}
                language={diff.language}
                viewMode="unified"
                showHeader={true}
                showStats={true}
                maxHeight="280px"
              />
            {:else if diff.oldContent !== undefined && diff.newContent !== undefined}
              <DiffViewer
                oldContent={diff.oldContent}
                newContent={diff.newContent}
                fileName={diff.fileName ?? m.chat_proposalCard_proposalFile_fallback()}
                language={diff.language}
                viewMode="unified"
                showHeader={true}
                showStats={true}
                maxHeight="280px"
              />
            {/if}
          </div>
        {/if}

        {#if bulkItems.length > 0}
          <BulkProposalItems
            items={bulkItems}
            bind:selectedIds={selectedBulkItemIds}
            disabled={actionDisabled}
          />
        {/if}

        {#if proposal.preview.warnings?.length}
          <div class="type-caption text-warning">
            {#each proposal.preview.warnings as warning}
              <div>⚠ {warning}</div>
            {/each}
          </div>
        {/if}
      </div>

      {#if statusMessage}
        <div
          bind:this={statusElement}
          class={isApplied
            ? 'type-caption border-t border-success/30 bg-success/10 px-3 py-2 text-success focus:outline-none'
            : isFailed
              ? 'type-caption border-t border-border px-3 py-2 text-error-foreground focus:outline-none'
              : 'type-caption border-t border-border px-3 py-2 text-muted-foreground focus:outline-none'}
          role="status"
          aria-live={isFailed ? 'assertive' : 'polite'}
          tabindex="-1"
        >
          {#if isApplied}
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-1 font-medium"
            >
              <Fa icon={faCircleCheck} class="h-3 w-3" />
              <span>{statusMessage}</span>
            </span>
          {:else}
            {statusMessage}
          {/if}
        </div>
      {/if}

      {#if !isApplied}
        <div
          class="flex items-center justify-end gap-2 border-t border-border bg-muted/10 px-3 py-3"
        >
          <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleDiscard}
            >{m.chat_shared_discard_label()}</Button
          >
          <Button
            size="sm"
            disabled={actionDisabled}
            onclick={handleApply}
            aria-keyshortcuts="Enter"
          >
            {isApplying
              ? m.chat_shared_applying_label()
              : isFailed
                ? m.chat_shared_retry_label()
                : (proposal.preview.applyLabel ?? m.chat_shared_apply_label())}
          </Button>
        </div>
      {/if}
    {/if}
  </section>
{/if}
