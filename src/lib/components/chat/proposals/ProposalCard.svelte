<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCircleCheck, faPencil } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { getSpecialistById } from '$lib/constants/specialists';
  import { DiffViewer } from '$lib/components/ui/diff';
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
  import { goto } from '$app/navigation';
  import {
    selectProposalError,
    selectProposalResult,
    selectProposalStatus,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import { requestPrBranchLookup } from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-slice';
  import { selectPrBranchLookupEntries } from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-selectors';
  import type { PrBranchLookupRequest } from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-types';
  import { store as appStore } from "$store/renderer/store";
  import RepoAndBranchPicker from '$lib/components/workspace/initializer/RepoAndBranchPicker.svelte';
  import SpecialistDropdown from '$lib/components/chat/SpecialistDropdown.svelte';

  interface Props {
    proposal: Proposal;
    disabled?: boolean;
    onApply?: (detail: ProposalActionDetail) => void;
    onDiscard?: (detail: ProposalActionDetail) => void;
    onUndo?: (proposalId: string) => void;
  }

  type EditorHandle = {
    focus: () => void;
    setSelectionRange?: (
      start: number,
      end: number,
      direction?: 'forward' | 'backward' | 'none',
    ) => void;
  };

  let { proposal, disabled = false, onApply, onDiscard, onUndo }: Props = $props();

  let rootElement = $state<HTMLElement | undefined>();
  let statusElement = $state<HTMLElement | undefined>();
  let isDismissed = $state(false);
  let fieldValues = $state<Record<string, string>>({});
  let selectedBulkItemIds = $state<string[]>([]);
  let editingFieldKey = $state<string | null>(null);
  let draftFieldValue = $state('');
  let activeEditor = $state<EditorHandle | undefined>();
  let syncedWorkspaceProposal: Proposal | undefined;
  let workspaceInitialPrompt = $state('');
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
  const BEFORE_AFTER_STACK_THRESHOLD = 40;

  const prBranchLookupEntries = selectPrBranchLookupEntries();

  const fields = $derived(proposal.preview.fields ?? []);
  const bulkItems = $derived(proposal.preview.bulkItems ?? []);
  const diff = $derived(proposal.preview.diff);
  const kindLabel = $derived(proposal.kind.replace(/-/g, ' '));
  const proposalId = $derived(getProposalId(proposal));
  const lifecycleStatus = selectProposalStatus(untrack(() => proposalId));
  const lifecycleError = selectProposalError(untrack(() => proposalId));
  const lifecycleResult = selectProposalResult(untrack(() => proposalId));
  const isWorkspaceCreate = $derived(proposal.kind === 'workspace-create');
  const settingsProposal = $derived(isSettingsChangeProposal(proposal) ? proposal : undefined);
  const specialistProposal = $derived(isSpecialistEditProposal(proposal) ? proposal : undefined);
  const shortcutModifier = $derived(
    typeof navigator !== 'undefined' && navigator.userAgent?.includes('Mac') ? '⌘' : 'Ctrl',
  );
  const isApplying = $derived($lifecycleStatus === 'applying');
  const isUndoing = $derived($lifecycleStatus === 'undoing');
  const isFailed = $derived($lifecycleStatus === 'failed');
  const isApplied = $derived($lifecycleStatus === 'applied');
  const createdWorkspaceId = $derived($lifecycleResult?.workspaceId);
  const isWorkspaceCreated = $derived(isWorkspaceCreate && isApplied);
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
  const actionDisabled = $derived(
    disabled ||
      isApplying ||
      isUndoing ||
      isApplied ||
      isAwaitingPrBranchLookup ||
      prBranchLoading,
  );
  const metadataIdPrefix = $derived(`proposal-${toDomId(proposalId)}`);
  const cardClass = $derived.by(() => {
    if (isWorkspaceCreate) {
      return isWorkspaceCreated
        ? 'my-2 w-full max-w-xl rounded-xl border border-border/60 bg-muted/10 p-4 sm:p-5'
        : 'my-2 w-full max-w-xl rounded-xl border border-border bg-background p-4 sm:p-5';
    }
    return isApplied
      ? 'my-2 w-full max-w-xl overflow-hidden rounded-lg border border-green-500/30 bg-green-500/5'
      : 'my-2 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-background';
  });

  $effect(() => {
    fieldValues = Object.fromEntries(
      fields.map((field) => [field.key, formatValue(getFieldValue(field))]),
    );
    selectedBulkItemIds = bulkItems
      .filter((item) => item.selected !== false && !item.disabled)
      .map((item) => item.id);
  });

  $effect(() => {
    if (!statusMessage) return;
    void tick().then(() => statusElement?.focus());
  });

  $effect(() => {
    if (!isWorkspaceCreate || syncedWorkspaceProposal === proposal) return;
    syncedWorkspaceProposal = proposal;
    const workspaceCreate = getWorkspaceCreateFields();
    workspaceInitialPrompt = workspaceCreate.initialPrompt ?? '';
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

    appStore.dispatch(requestPrBranchLookup(prBranchLookupRequest));
  });

  $effect(() => {
    const branch = prBranchLookup?.status === 'succeeded' ? prBranchLookup.branch?.trim() : '';
    if (!branch || prBranchUserEdited || workspaceBranch !== 'main') return;

    workspaceBranch = branch;
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
    if (field.editable !== false && field.key === 'title') return 'Add title…';
    return field.editable !== false ? '(not set)' : '—';
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
  }

  function handleBranchChange(event: CustomEvent<{ branch: string }>) {
    prBranchUserEdited = true;
    prBranchLookupKey = '';
    prBranchLookupRequest = undefined;
    workspaceBranch = event.detail.branch;
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
    addPopulatedField(editedFields, 'initialPrompt', workspaceInitialPrompt);
    addPopulatedField(editedFields, 'repoPath', workspaceRepoPath);
    addPopulatedField(editedFields, 'repoType', workspaceRepoType);
    addPopulatedField(editedFields, 'githubUrl', workspaceGithubUrl);
    addPopulatedField(editedFields, 'clonePath', workspaceClonePath);
    addPopulatedField(editedFields, 'branch', workspaceBranch);
    addPopulatedField(editedFields, 'isNewRepo', workspaceIsNewRepo);
    addPopulatedField(editedFields, 'isValidPath', workspaceIsValidPath);
    addPopulatedField(editedFields, 'scope', workspaceScope);
    addPopulatedField(editedFields, 'specialist', workspaceSpecialist);
    return editedFields;
  }

  function handleCardKeydown(event: KeyboardEvent) {
    if (!isWorkspaceCreate || disabled || isWorkspaceCreated) return;
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    handleApply();
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
      if (isAwaitingPrBranchLookup) return 'Detecting PR branch…';
      if (isApplying) return 'Creating workspace…';
      if (isFailed) {
        return `Workspace creation failed${$lifecycleError ? `: ${$lifecycleError}` : ''}`;
      }
      return '';
    }
    if (isApplying) return 'Applying…';
    if (isUndoing) return 'Undoing…';
    if (isFailed) return `Action failed${$lifecycleError ? `: ${$lifecycleError}` : ''}`;
    if ($lifecycleStatus === 'applied') return 'Applied.';
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
    isDismissed = true;
    onDiscard?.(detail);
    emitAction('proposaldiscard', detail);
  }

  async function handleOpenCreatedWorkspace(event: MouseEvent) {
    if (!createdWorkspaceId) return;
    event.preventDefault();
    await goto(`/workspace/${createdWorkspaceId}`);
  }
</script>

{#if isDismissed}
  <div class="my-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-subtle">
    Discarded: {proposal.preview.title}
  </div>
{:else if settingsProposal}
  <SettingsChangeCard proposal={settingsProposal} {disabled} {onApply} {onDiscard} {onUndo} />
{:else if specialistProposal}
  <SpecialistChangeCard proposal={specialistProposal} {disabled} {onApply} {onDiscard} {onUndo} />
{:else}
  <section
    bind:this={rootElement}
    class={cardClass}
    data-proposal-kind={proposal.kind}
    data-lifecycle-status={$lifecycleStatus}
    data-apply-tool-call-id={proposal.applyToolCallId}
    title={proposal.applyToolCallId ? `Tool ${proposal.applyToolCallId}` : undefined}
    use:cardKeyboardShortcut
  >
    {#if isWorkspaceCreate}
      {#if isWorkspaceCreated}
        <div class="space-y-3" data-state="workspace-created">
          <div class="flex items-start gap-2">
            <span aria-hidden="true" class="mt-0.5 flex shrink-0 items-center">
              <Fa icon={faCircleCheck} class="h-4 w-4 text-green-500" />
            </span>
            <h3 class="min-w-0 text-sm font-semibold leading-snug text-foreground">
              {proposal.preview.title}
            </h3>
          </div>

          {#if workspaceInitialPrompt}
            <p class="line-clamp-3 whitespace-pre-wrap text-xs text-subtle">
              {workspaceInitialPrompt}
            </p>
          {/if}

          <dl class="space-y-1 text-xs">
            {#if createdRepoLabel}
              <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
                <dt class="text-subtle">Repo</dt>
                <dd class="min-w-0 truncate text-foreground">{createdRepoLabel}</dd>
              </div>
            {/if}
            {#if workspaceBranch}
              <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
                <dt class="text-subtle">Base branch</dt>
                <dd class="min-w-0 truncate text-foreground">{workspaceBranch}</dd>
              </div>
            {/if}
            {#if createdSpecialistLabel}
              <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
                <dt class="text-subtle">Specialist</dt>
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
                <Button size="sm" class="text-white">Open workspace</Button>
              </a>
            {:else}
              <span class="text-xs text-subtle" data-testid="proposal-workspace-created"
                >Workspace created.</span
              >
            {/if}
          </div>
        </div>
      {:else}
        <div class="space-y-4">
          <h3 class="text-sm font-semibold leading-snug text-foreground">
            {proposal.preview.title}
          </h3>

          <Textarea
            bind:value={workspaceInitialPrompt}
            placeholder="What would you like to work on?"
            minHeight={112}
            maxHeight={240}
            doesExpandToFit
            noFocusStyle
            class="resize-y border-border bg-background text-sm"
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
                class="text-sm text-subtle"
                data-metadata-label
              >
                Repo
              </span>
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
            </div>

            <div
              class="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-2"
              data-row="metadata"
              role="group"
              aria-labelledby={`${metadataIdPrefix}-branch-label`}
            >
              <span
                id={`${metadataIdPrefix}-branch-label`}
                class="pt-1 text-sm text-subtle"
                data-metadata-label
              >
                Base branch
              </span>
              <div class="min-w-0 space-y-1">
                <div class="min-w-0" data-testid="proposal-branch-picker">
                  <RepoAndBranchPicker
                    repoPath={workspaceRepoPath}
                    branch={workspaceBranch}
                    repoType={workspaceRepoType}
                    githubUrl={workspaceGithubUrl}
                    presentation="metadata"
                    field="branch"
                    isLoading={prBranchLoading}
                    onBranchChange={handleBranchChange}
                  />
                </div>
                {#if prBranchLookupFailed}
                  <p class="px-2 text-xs text-subtle" data-testid="proposal-branch-lookup-failure">
                    Couldn't auto-detect base branch; using default
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
                class="text-sm text-subtle"
                data-metadata-label
              >
                Specialist
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
            <div class="text-xs text-subtle">
              {#each proposal.preview.warnings as warning}
                <div>⚠ {warning}</div>
              {/each}
            </div>
          {/if}

          {#if statusMessage}
            <div
              bind:this={statusElement}
              class="text-xs text-subtle focus:outline-none"
              role="status"
              aria-live={isFailed ? 'assertive' : 'polite'}
              tabindex="-1"
            >
              {statusMessage}
            </div>
          {/if}

          <div class="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleDiscard}
              >Discard</Button
            >
            <Button
              size="sm"
              class="text-white"
              disabled={actionDisabled}
              onclick={handleApply}
              aria-keyshortcuts="Enter"
            >
              <span>
                {isAwaitingPrBranchLookup
                  ? 'Detecting branch…'
                  : isApplying
                    ? 'Applying…'
                    : isFailed
                      ? 'Retry'
                      : 'Create workspace'}
              </span>
              {#if !isApplying && !isFailed}
                <span class="opacity-50">{shortcutModifier}+↵</span>
              {/if}
            </Button>
          </div>
        </div>
      {/if}
    {:else}
      <div class="px-3 pt-3">
        <div class="min-w-0 space-y-0.5">
          <div class="text-xs font-medium uppercase tracking-wide text-subtle">{kindLabel}</div>
          <h3 class="text-sm font-semibold leading-snug text-foreground">
            {proposal.preview.title}
          </h3>
          {#if proposal.preview.summary}
            <p class="text-xs leading-relaxed text-subtle">{proposal.preview.summary}</p>
          {/if}
        </div>
      </div>

      <div class="space-y-3 px-3 py-2.5">
        {#if fields.length > 0}
          <div class="space-y-1.5">
            {#each fields as field (field.key)}
              <div class="field-row" data-proposal-field={field.key}>
                {#if field.before !== undefined || field.after !== undefined}
                  <div class="mb-1 text-xs font-medium text-subtle">{field.label}</div>
                  <div
                    class={shouldStackBeforeAfter(field)
                      ? 'flex flex-col gap-1.5 text-sm'
                      : 'flex min-w-0 items-center gap-2 text-sm'}
                    data-proposal-before-after-row={field.key}
                  >
                    <div class="min-w-0 rounded px-2 py-1.5 text-subtle">
                      <span class="sr-only">Before: </span>
                      <div class="whitespace-pre-wrap break-words line-through">
                        {formatValue(field.before) || '—'}
                      </div>
                    </div>
                    <div
                      class="shrink-0 px-2 text-subtle"
                      data-proposal-before-after-arrow
                      aria-hidden="true"
                    >
                      →
                    </div>
                    {#if editingFieldKey === field.key}
                      <div class="min-w-0 flex-1 rounded px-2 py-1.5 text-foreground">
                        <span class="sr-only">After: </span>
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
                        class="group min-w-0 flex-1 rounded px-2 py-1.5 text-foreground transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        data-proposal-field-value={field.key}
                        role="button"
                        tabindex="0"
                        aria-label={`Edit ${field.label}`}
                        onclick={() => void startEditing(field)}
                        onkeydown={(event) => handleEditableKeydown(event, field)}
                      >
                        <span class="sr-only">After: </span>
                        <div
                          class="flex cursor-text items-start gap-1.5 whitespace-pre-wrap break-words"
                        >
                          <span class="min-w-0 flex-1">
                            {#if getAfterDisplayValue(field)}
                              {getAfterDisplayValue(field)}
                            {:else}
                              <span class="text-subtle">{getEmptyFieldLabel(field)}</span>
                            {/if}
                          </span>
                          <Fa
                            icon={faPencil}
                            size="xs"
                            class="mt-0.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
                          />
                        </div>
                      </div>
                    {:else}
                      <div
                        class="min-w-0 flex-1 rounded px-2 py-1.5 text-foreground"
                        data-proposal-field-value={field.key}
                      >
                        <span class="sr-only">After: </span>
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
                    <div class="mb-1 text-xs font-medium text-subtle">{field.label}</div>
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
                    class="group rounded px-2 py-1.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-proposal-field-value={field.key}
                    role="button"
                    tabindex="0"
                    aria-label={`Edit ${field.label}`}
                    onclick={() => void startEditing(field)}
                    onkeydown={(event) => handleEditableKeydown(event, field)}
                  >
                    <div class="text-xs font-medium text-subtle">{field.label}</div>
                    <div
                      class="flex cursor-text items-start gap-1.5 whitespace-pre-wrap break-words text-sm text-foreground"
                    >
                      <span class="min-w-0 flex-1">
                        {#if getFieldDisplayValue(field)}
                          {getFieldDisplayValue(field)}
                        {:else}
                          <span class="text-subtle">{getEmptyFieldLabel(field)}</span>
                        {/if}
                      </span>
                      <Fa
                        icon={faPencil}
                        size="xs"
                        class="mt-0.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
                      />
                    </div>
                  </div>
                {:else}
                  <div data-proposal-field-value={field.key}>
                    <div class="mb-1 text-xs font-medium text-subtle">{field.label}</div>
                    <div class="whitespace-pre-wrap break-words text-sm text-foreground">
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
          <div class="overflow-hidden rounded-md border border-border/60">
            {#if diff.patch}
              <DiffViewer
                patch={diff.patch}
                fileName={diff.fileName ?? 'proposal'}
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
                fileName={diff.fileName ?? 'proposal'}
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
          <BulkProposalItems items={bulkItems} bind:selectedIds={selectedBulkItemIds} disabled={actionDisabled} />
        {/if}

        {#if proposal.preview.warnings?.length}
          <div class="text-xs text-subtle">
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
            ? 'border-t border-green-500/20 px-3 py-2 text-xs text-green-700 focus:outline-none dark:text-green-400'
            : 'border-t border-border/60 px-3 py-2 text-xs text-subtle focus:outline-none'}
          role="status"
          aria-live={isFailed ? 'assertive' : 'polite'}
          tabindex="-1"
        >
          {#if isApplied}
            <span class="inline-flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 font-medium">
              <Fa icon={faCircleCheck} class="h-3 w-3" />
              <span>{statusMessage}</span>
            </span>
          {:else}
            {statusMessage}
          {/if}
        </div>
      {/if}

      {#if !isApplied}
        <div class="flex items-center justify-end gap-2 px-3 pb-3 pt-1">
          <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleDiscard}
            >Discard</Button
          >
          <Button size="sm" disabled={actionDisabled} onclick={handleApply} aria-keyshortcuts="Enter">
            {isApplying ? 'Applying…' : isFailed ? 'Retry' : (proposal.preview.applyLabel ?? 'Apply')}
          </Button>
        </div>
      {/if}
    {/if}
  </section>
{/if}
