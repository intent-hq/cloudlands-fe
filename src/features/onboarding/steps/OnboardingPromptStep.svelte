<script lang="ts">
  /**
   * OnboardingPromptStep — Step 3 of the onboarding flow.
   *
   * Contains the rich text prompt input, suggestion pills, branch picker,
   * setup script disclosure, PR branch suggestion, error state, and the
   * "Create workspace" button.
   */
  import { fly, slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faArrowRight,
    faPaperclip,
    faMagicWandSparkles,
    faArrowsRotate,
    faCodeBranch,
  } from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import AttachmentPreview from '$lib/components/chat/AttachmentPreview.svelte';
  import { hasBlockingAttachments, type ContextItem } from '$lib/components/chat/input/context-api';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import SetupScriptModal from '$lib/components/modals/SetupScriptModal.svelte';
  import { setupScriptDisplayName, type SetupScriptNameSource } from '$features/setup-scripts';
  import IssueSuggestions from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import WorkspaceCreationError from '$features/onboarding/steps/WorkspaceCreationError.svelte';
  import type { ProjectSelection } from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import type { IssueSelectionData } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import { selectSpecialists } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { appClient } from '$lib/client';
  import { createLogger } from '$lib/utils/client-logger';
  import { formatFileSize } from '$lib/utils/file-utils';
  import {
    imageFilesToContextItems,
    REFERENCE_IMAGE_MAX_BYTES,
  } from '$lib/components/chat/input/image-context-items';
  import { splitDroppedItems } from '$lib/utils/drop-split';
  import { isRemoteBackend } from '$lib/components/chat/input/attachment-placement';

  const COORDINATOR_SPECIALIST_ID = 'spec-writer';

  const logger = createLogger('OnboardingPromptStep');
  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const activeProviderId$ = selectActiveProviderId();
  const specialists$ = selectSpecialists();

  interface Props {
    // Input state
    onboardingInputValue: string;
    isOnboardingCreating: boolean;
    isOnboardingEnhancing: boolean;
    onboardingCreationError: string | null;
    /** Daemon `error.data.code` for a failed create (PROTOCOL §9.1, monorepo#826). */
    onboardingCreationErrorCode: string | null;

    // Project context
    projectSelection: ProjectSelection | null;
    onboardingGithubRepoInfo: { owner: string; repo: string } | null;

    // Branch state
    selectedPRBranch: string;
    onboardingSkipIsolation: boolean;

    // Setup script
    setupScript: string;
    showSetupScript: boolean;
    setupScriptName: string;
    setupScriptNameSource: SetupScriptNameSource;
    isCustomSetupScript: boolean;
    /** Repo-committed `.intent/config.json` script, forwarded to SetupScriptModal. */
    repoConfigScript: string | null;
    /**
     * Hide the setup-script disclosure row: the repo-config probe is in
     * flight, or the unedited repo-config script is the active default (it
     * applies silently without a visible control).
     */
    hideSetupScriptControl?: boolean;

    // Model picker (initial Coordinator agent)
    /** User-picked model — undefined means use the Coordinator's auto-resolved default. */
    selectedModel?: string | undefined;
    /** Whether the user explicitly overrode the model (vs the resolved default). */
    modelWasOverridden?: boolean;
    /** Callback when the user picks a model. */
    onModelChange?: (model: string) => void;

    // Suggestions
    visibleSuggestions: string[];
    focusedSuggestionIndex: number;

    /**
     * Staged attachment context items (non-image files, path-only). Owned by
     * the parent so the submit path can place them into the created
     * workspace (`file.placeAttachment`, PROTOCOL §5.9) and reference them
     * from the first message.
     */
    stagedContextItems?: ContextItem[];

    /**
     * Image attachments as context items (`imageData`/`imageMimeType`),
     * rendered as thumbnail squares below the editor — never inline in the
     * editor. Owned by the parent so the submit path can send them as
     * attachment-reference blocks on the first message.
     */
    imageContextItems?: ContextItem[];

    // Handlers
    onSubmit: () => void;
    onEnhancePrompt: () => void;
    /** §5.31 gate — enhance button hidden when the active provider is not auggie */
    enhancePromptAvailable?: boolean;

    onContentChange: () => void;
    onFocus: () => void;
    onKeydown: (e: KeyboardEvent) => void;
    onPromptSelect: (prompt: string) => void;
    onIssueSelect: (text: string, metadata?: IssueSelectionData) => void;
    onBranchSet: (branch: string) => void;
    onProjectChange: (selection: ProjectSelection) => void;
    onShuffleSuggestions: () => void;
    onSkipIsolationChange: (val: boolean) => void;
    onBranchBehindChange: (behind: number) => void;
    onShowSetupScriptChange: (show: boolean) => void;
  }

  let {
    onboardingInputValue = $bindable(),
    isOnboardingCreating,
    isOnboardingEnhancing,
    onboardingCreationError,
    onboardingCreationErrorCode,
    projectSelection,
    onboardingGithubRepoInfo,
    selectedPRBranch,
    onboardingSkipIsolation = $bindable(),

    setupScript = $bindable(),
    showSetupScript = $bindable(),
    setupScriptName = $bindable(),
    setupScriptNameSource = $bindable(),
    isCustomSetupScript = $bindable(),
    repoConfigScript,
    hideSetupScriptControl = false,
    selectedModel = undefined,
    modelWasOverridden = false,
    onModelChange = () => {},
    visibleSuggestions,
    focusedSuggestionIndex = $bindable(),
    stagedContextItems = $bindable([]),
    imageContextItems = $bindable([]),
    onSubmit,
    onEnhancePrompt,
    enhancePromptAvailable = true,

    onContentChange,
    onFocus,
    onKeydown,
    onPromptSelect,
    onIssueSelect,
    onBranchSet,
    onProjectChange,
    onShuffleSuggestions,
    onSkipIsolationChange,
    onBranchBehindChange,
    onShowSetupScriptChange,
  }: Props = $props();

  // Refs managed by this component
  let onboardingRichTextarea: RichTextarea | null = $state(null);
  let onboardingFileInput: HTMLInputElement | null = $state(null);
  let richTextareaWrapper: HTMLDivElement | null = $state(null);

  const hasResolvedBranch = $derived(
    projectSelection?.type === 'new' ||
      Boolean(projectSelection?.branch.trim()) ||
      Boolean(selectedPRBranch.trim()),
  );

  // Drag and drop state
  let isDragging = $state(false);
  let dragCounter = $state(0);

  // Non-zero while dropped/pasted/selected files are being converted to
  // context items (FileReader is async) — submit is gated on it so a create
  // can't race the conversion and silently drop the attachment. A counter
  // (not a boolean) so overlapping conversions don't clear the gate early.
  let processingImageCount = $state(0);
  const isProcessingImages = $derived(processingImageCount > 0);

  // Daemon-resolved default-model preview for the Coordinator (PROTOCOL
  // §5.11): `specialist.list` with the onboarding provider context returns
  // additive `resolvedModel` fields computed by the same resolver a no-model
  // create uses, so the picker displays exactly what the daemon would pin.
  // Absent resolvedModel means "Provider default". The store's specialist
  // view (daemon-default-provider context) is the fallback until the
  // per-provider fetch lands. Mirrors InitialAgentPicker.
  const onboardingProvider = $derived($activeProviderId$ || $defaultProviderId$);
  let resolvedModelsByProvider = $state<Record<string, Record<string, string | undefined>>>({});

  // Bumped on every store specialist-view refresh; in-flight fetches from an
  // older generation are dropped so they can't overwrite fresher previews.
  let previewsGeneration = 0;

  // Invalidate cached previews whenever the store's specialist view refreshes
  // (daemon `specialists:changed` → list subscription refetch).
  $effect(() => {
    void $specialists$;
    previewsGeneration += 1;
    resolvedModelsByProvider = {};
  });

  $effect(() => {
    const provider = onboardingProvider;
    if (!provider || provider in resolvedModelsByProvider) return;
    const generation = previewsGeneration;
    void (async () => {
      try {
        const defs = await appClient.specialists.list(provider);
        if (generation !== previewsGeneration || defs.length === 0) return;
        const byId: Record<string, string | undefined> = {};
        for (const def of defs) byId[def.id] = def.resolvedModel;
        resolvedModelsByProvider = { ...resolvedModelsByProvider, [provider]: byId };
      } catch (error) {
        logger.debug('Failed to fetch resolved-model previews:', { provider, error });
      }
    })();
  });

  const coordinatorDefaultModel = $derived.by(() => {
    const providerView = resolvedModelsByProvider[onboardingProvider];
    if (providerView) return providerView[COORDINATOR_SPECIALIST_ID];
    return $specialists$.find((s) => s.id === COORDINATOR_SPECIALIST_ID)?.resolvedModel;
  });

  // Expose the RichTextarea ref so the parent can call methods on it
  export function getRichTextarea(): RichTextarea | null {
    return onboardingRichTextarea;
  }

  /**
   * Snapshot of the picker's effective default selection for the submit-time
   * default commit (monorepo#3044): the daemon resolvedModel preview when the
   * user never overrode it (undefined ⇒ "Provider default"), plus the provider
   * context it was resolved under so the caller can detect a mismatch with the
   * create's resolved provider. Unlike the displayed `coordinatorDefaultModel`,
   * this never uses the `$specialists$` fallback — that view was resolved in
   * the daemon-default-provider context, so certifying it for
   * `onboardingProvider` could persist another provider's model when the user
   * submits before the provider-specific fetch lands.
   */
  export function getEffectiveDefaultModel(): {
    model: string | undefined;
    provider: string;
  } {
    return {
      model: resolvedModelsByProvider[onboardingProvider]?.[COORDINATOR_SPECIALIST_ID],
      provider: onboardingProvider,
    };
  }

  /** Open the file input dialog. */
  function handleFileSelect() {
    onboardingFileInput?.click();
  }

  /** Handle selected files — images become thumbnail context items, other
   * files are staged path-only. */
  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;
    await processImageFiles(Array.from(files));
    target.value = '';
  }

  /** Process files from file input, drag-and-drop, or paste: images become
   * context items rendered as thumbnails (30 MiB cap — they travel as
   * attachment-reference blocks, monorepo#3338), other files staged as
   * path-only context items placed at workspace.create
   * (`file.placeAttachment`, PROTOCOL §5.9) — never inlined, never dropped. */
  async function processImageFiles(files: File[]) {
    processingImageCount += 1;
    try {
      await processImageFilesInner(files);
    } finally {
      processingImageCount -= 1;
    }
  }

  /** Submit guard: every submit surface (editor Cmd+Enter, Create button,
   * error-banner Retry) routes through here so a submit can't race an
   * in-flight image conversion and drop the attachment. */
  function handleSubmit() {
    if (isProcessingImages) return;
    onSubmit();
  }

  async function processImageFilesInner(files: File[]) {
    const imageFiles: File[] = [];
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        imageFiles.push(file);
      } else {
        // Stage path-only; no resolvable path (e.g. clipboard bytes) is an
        // immediate failed pill that blocks create until removed.
        const sourcePath =
          (
            window as unknown as { electronAPI?: { getPathForFile?: (f: File) => string } }
          ).electronAPI?.getPathForFile?.(file) ?? '';
        const fileName = file.name || `pasted-file-${Date.now()}`;
        stagedContextItems = [
          ...stagedContextItems,
          {
            id: `staged-file-${Date.now()}-${stagedContextItems.length}`,
            type: 'file',
            label: fileName,
            description: `${file.type || 'file'} • ${formatFileSize(file.size)}`,
            path: fileName,
            attachmentMimeType: file.type || undefined,
            attachmentSize: file.size,
            sourcePath,
            placementStatus: sourcePath ? undefined : 'failed',
          },
        ];
        if (!sourcePath) {
          toast.error(m.onboarding_promptStep_attachmentNoPath_error({ name: fileName }));
        }
      }
    }

    const newItems = await imageFilesToContextItems(imageFiles, {
      maxBytes: REFERENCE_IMAGE_MAX_BYTES,
    });
    if (newItems.length > 0) {
      imageContextItems = [...imageContextItems, ...newItems];
    }
  }

  function removeStagedItem(id: string) {
    stagedContextItems = stagedContextItems.filter((item) => item.id !== id);
  }

  function removeImageItem(id: string) {
    imageContextItems = imageContextItems.filter((item) => item.id !== id);
  }

  /** Intercept clipboard file pastes (mirrors SimpleRichInput) so pasted
   * images become thumbnail context items instead of TipTap inline nodes. */
  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          pastedFiles.push(file);
        }
      }
    }

    if (pastedFiles.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for files
      await processImageFiles(pastedFiles);
    }
  }

  /** Handle drag enter - track drag state with counter for nested elements */
  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer?.types.includes('Files')) {
      isDragging = true;
    }
  }

  /** Handle drag leave - decrement counter and clear drag state when leaving container */
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      isDragging = false;
    }
  }

  /** Handle drag over - required to allow drop */
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** Handle drop - process dropped files */
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    dragCounter = 0;

    // Folder detection must happen HERE, synchronously in the drop event —
    // webkitGetAsEntry() returns null once the event loop turns.
    const { files, folderFiles } = splitDroppedItems(e.dataTransfer);
    if (files.length === 0 && folderFiles.length === 0) return;

    if (folderFiles.length > 0) {
      // Folders are path-only references — the agent reads them off the
      // host filesystem, which a remote daemon cannot do. Any folder in the
      // drop rejects the WHOLE drop when remote (files included). Mirrors
      // SimpleRichInput's folder-drop behavior.
      if (isRemoteBackend()) {
        toast.error(m.chat_richInput_folderDropRemote_error());
        return;
      }
      for (const folder of folderFiles) {
        stageFolderReference(folder);
      }
    }
    if (files.length > 0) {
      await processImageFiles(files);
    }
  }

  /**
   * Stage a dropped folder as a path-only context item (local daemon only).
   * Never placed via `file.placeAttachment` (the daemon rejects directories)
   * — the submit path carries the absolute host path as a context reference
   * on the initial message instead.
   *
   * When the Electron `getPathForFile` bridge is unavailable or returns ''
   * the folder is SKIPPED with a toast: a bare folder name would ride
   * `contextReferences` as if it were an absolute host path the agent
   * cannot resolve. Mirrors SimpleRichInput.addFolderReference.
   */
  function stageFolderReference(folder: File) {
    const absolutePath =
      (
        window as unknown as { electronAPI?: { getPathForFile?: (f: File) => string } }
      ).electronAPI?.getPathForFile?.(folder) ?? '';
    if (!absolutePath) {
      logger.warn('Dropped folder has no resolvable absolute path; skipping', {
        name: folder.name,
      });
      toast.error(m.onboarding_promptStep_attachmentNoPath_error({ name: folder.name }));
      return;
    }
    // Path-keyed like folder @-mentions, so two dropped folders sharing a
    // basename stay distinct. Re-dropping the SAME folder is a no-op: the
    // strip is keyed by item.id, so a duplicate id would break keyed
    // rendering and make one remove drop both pills while both references
    // still ride the submit.
    const id = `staged-folder-${absolutePath}`;
    if (stagedContextItems.some((item) => item.id === id)) return;
    // Windows-aware basename fallback ('\' or '/' separators).
    const label = folder.name || absolutePath.split(/[/\\]/).pop() || absolutePath;
    stagedContextItems = [...stagedContextItems, { id, type: 'folder', label, path: absolutePath }];
  }

  /**
   * Intercept suggestion keyboard navigation in the capture phase so it runs
   * BEFORE ProseMirror's handleKeyDown (which would otherwise insert a newline
   * on Enter before our bubble-phase handler can preventDefault).
   */
  function handleSuggestionKeydownCapture(e: KeyboardEvent) {
    if (onboardingInputValue.trim()) return;
    const suggestions = visibleSuggestions.slice(0, 4);
    const maxIndex = suggestions.length + 1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      focusedSuggestionIndex =
        focusedSuggestionIndex < maxIndex - 1 ? focusedSuggestionIndex + 1 : -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      focusedSuggestionIndex =
        focusedSuggestionIndex > -1 ? focusedSuggestionIndex - 1 : maxIndex - 1;
    } else if (e.key === 'Enter' && focusedSuggestionIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      if (focusedSuggestionIndex < suggestions.length) {
        onPromptSelect(suggestions[focusedSuggestionIndex]);
        focusedSuggestionIndex = -1;
      } else {
        const shuffleIdx = focusedSuggestionIndex;
        onShuffleSuggestions();
        focusedSuggestionIndex = shuffleIdx;
      }
    } else if (e.key === 'Escape' && focusedSuggestionIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      focusedSuggestionIndex = -1;
    }
  }

  // Attach suggestion keydown in capture phase so it fires before ProseMirror
  $effect(() => {
    const el = richTextareaWrapper;
    if (!el) return;
    el.addEventListener('keydown', handleSuggestionKeydownCapture, true);
    return () => el.removeEventListener('keydown', handleSuggestionKeydownCapture, true);
  });
</script>

<div class="max-w-5xl mx-auto space-y-3">
  {#if isOnboardingCreating}
    <div
      class="onboarding-creating-state space-y-4"
      in:fly={{ y: 12, duration: 350, easing: cubicOut }}
    >
      <div class="rounded-xl bg-muted/20 border border-border px-4 py-3">
        <p class="text-sm text-foreground leading-relaxed">
          {onboardingInputValue}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div class="relative flex items-center justify-center w-4 h-4 shrink-0">
          <div
            class="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin"
          ></div>
        </div>
        <span class="text-sm text-muted-foreground"
          >{m.onboarding_promptStep_settingUpWorkspace_label()}</span
        >
      </div>
    </div>
  {:else}
    <!-- Normal editing state -->
    <div class="relative w-full z-0">
      <input
        bind:this={onboardingFileInput}
        type="file"
        multiple
        class="hidden"
        onchange={handleFileChange}
      />
      <div
        class="relative rich-input-container flex flex-col bg-background rounded-xl border shadow-xs transition-colors overflow-hidden {isDragging
          ? 'border-primary border-dashed'
          : 'border-border'}"
        ondragenter={handleDragEnter}
        ondragleave={handleDragLeave}
        ondragover={handleDragOver}
        ondrop={handleDrop}
        onpaste={handlePaste}
      >
        <!-- Drop zone overlay -->
        {#if isDragging}
          <div
            class="absolute inset-0 bg-primary/5 z-20 flex items-center justify-center pointer-events-none rounded-xl"
          >
            <div class="flex flex-col items-center gap-2 text-primary">
              <Fa icon={faPaperclip} size={24} />
              <span class="text-sm font-medium">{m.onboarding_promptStep_dropFiles_label()}</span>
            </div>
          </div>
        {/if}

        <div class="w-full relative overflow-hidden rounded-t-xl" bind:this={richTextareaWrapper}>
          <RichTextarea
            bind:this={onboardingRichTextarea}
            bind:value={onboardingInputValue}
            repoPath={projectSelection?.repoPath || undefined}
            onsubmit={handleSubmit}
            onchange={onContentChange}
            onfocus={onFocus}
            onkeydown={onKeydown}
            minHeight={180}
            maxHeight={350}
            autoFocus={true}
            class="bg-transparent border-none"
          />
          {#if !onboardingInputValue.trim()}
            <div class="absolute left-0 right-0 top-[52px] px-4 pointer-events-none">
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="flex flex-col gap-0.75 pointer-events-auto"
                role="listbox"
                aria-label={m.onboarding_promptStep_promptSuggestions_ariaLabel()}
              >
                {#each visibleSuggestions.slice(0, 4) as suggestion, i (suggestion)}
                  <button
                    type="button"
                    role="option"
                    id="suggestion-{i}"
                    aria-selected={focusedSuggestionIndex === i}
                    class="text-left text-sm transition-colors cursor-pointer truncate flex items-center gap-1.5
                      {focusedSuggestionIndex === i
                      ? 'text-foreground'
                      : 'text-muted-foreground/50 hover:text-muted-foreground/70'}"
                    onclick={() => onPromptSelect(suggestion)}
                    in:fly={{
                      x: -6,
                      duration: 200,
                      delay: 30 * i,
                      easing: cubicOut,
                    }}
                  >
                    <Fa
                      icon={faArrowRight}
                      size={12}
                      class={focusedSuggestionIndex === i ? 'opacity-100' : 'opacity-60'}
                    />
                    {suggestion}
                  </button>
                {/each}
                <button
                  type="button"
                  role="option"
                  id="suggestion-shuffle"
                  aria-selected={focusedSuggestionIndex === visibleSuggestions.slice(0, 4).length}
                  class="text-left text-xs transition-colors cursor-pointer mt-0.75 inline-flex items-center gap-1.5
                    {focusedSuggestionIndex === visibleSuggestions.slice(0, 4).length
                    ? 'text-foreground'
                    : 'text-muted-foreground/30 hover:text-muted-foreground/70'}"
                  onclick={onShuffleSuggestions}
                >
                  <Fa icon={faArrowsRotate} size={12} />
                  <span></span>
                </button>
              </div>
            </div>
          {/if}
          {#if isOnboardingEnhancing}
            <div class="absolute inset-0 pointer-events-none overflow-hidden rounded-t-xl">
              <div
                class="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-pulse"
              ></div>
            </div>
          {/if}
        </div>

        <!-- Attachments: image thumbnails (lightbox + hover-remove) plus
             staged non-image chips with placement state (failed pills block
             create until removed) -->
        {#if imageContextItems.length > 0 || stagedContextItems.length > 0}
          <div class="px-2.5 pt-1 pb-1 flex flex-wrap gap-2 items-center">
            {#each imageContextItems as item (item.id)}
              <AttachmentPreview
                id={item.id}
                name={item.label}
                type={item.file?.type || item.imageMimeType || ''}
                size={item.file?.size}
                file={item.file}
                imageData={item.imageData}
                imageMimeType={item.imageMimeType}
                onRemove={removeImageItem}
                variant="thumbnail"
              />
            {/each}
            {#each stagedContextItems as item (item.id)}
              <AttachmentPreview
                id={item.id}
                name={item.label}
                type={item.attachmentMimeType || ''}
                size={item.attachmentSize}
                onRemove={removeStagedItem}
                variant="chip"
                placementStatus={item.placementStatus}
                placementError={item.placementError}
              />
            {/each}
          </div>
        {/if}

        <div class="flex items-center gap-2 px-2.5 pt-1 pb-2.5 overflow-x-auto relative">
          <IssueSuggestions
            onSelect={(text, metadata) => {
              onIssueSelect(text, metadata);
              if (metadata?.metadata?.sourceBranch) {
                onBranchSet(metadata.metadata.sourceBranch);
              }
            }}
            repositoryOwner={onboardingGithubRepoInfo?.owner}
            repositoryName={onboardingGithubRepoInfo?.repo}
          />

          <div class="absolute top-2 right-2.5 flex items-center">
            {#if enhancePromptAvailable}
              <Button
                type="button"
                onclick={onEnhancePrompt}
                size="icon-xs"
                variant="ghost-light"
                disabled={!onboardingInputValue.trim() && !isOnboardingEnhancing}
                tooltip={m.onboarding_promptStep_enhancePrompt_tooltip()}
              >
                {#if isOnboardingEnhancing}
                  <div class="animate-spin">
                    <Fa icon={faArrowsRotate} size="xs" />
                  </div>
                {:else}
                  <Fa icon={faMagicWandSparkles} size="xs" />
                {/if}
              </Button>
            {/if}

            <Button
              type="button"
              onclick={handleFileSelect}
              size="icon-xs"
              variant="ghost-light"
              tooltip={m.onboarding_promptStep_addFiles_tooltip()}
            >
              <Fa icon={faPaperclip} size="xs" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div class="onboarding-metadata-stack flex w-full min-w-0 flex-col gap-2">
      <!-- Branch picker -->
      {#if projectSelection?.type === 'local' && projectSelection?.repoPath}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="onboarding-metadata-row flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm cursor-pointer"
          in:fly={{ y: 10, duration: 200, easing: cubicOut }}
          onclick={(e) => {
            const trigger = e.currentTarget.querySelector('button');
            if (trigger && e.target !== trigger && !trigger.contains(e.target as Node)) {
              trigger.click();
            }
          }}
        >
          <span class="shrink-0 text-muted-foreground"
            >{m.onboarding_promptStep_branchOffOf_before()}</span
          >
          <BranchSelector
            variant="ghost"
            triggerClass="max-w-full pl-1 pr-1.5 font-medium bg-card/50 py-1.25 rounded-md border border-border"
            value={projectSelection.branch}
            repoPath={projectSelection.repoPath}
            repoType="local"
            hasTriggerIcon={false}
            showUncommittedIndicator={true}
            skipIsolation={onboardingSkipIsolation}
            {onSkipIsolationChange}
            onBranchStatusChange={(status) => {
              onBranchBehindChange(status.behind);
            }}
            onchange={(event) => {
              if (projectSelection) {
                onProjectChange({
                  ...projectSelection,
                  branch: event.detail.branch,
                });
              }
            }}
          />
        </div>
      {:else if projectSelection?.type === 'github' && projectSelection?.githubUrl}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="onboarding-metadata-row flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm cursor-pointer"
          in:fly={{ y: 10, duration: 200, easing: cubicOut }}
          onclick={(e) => {
            const trigger = e.currentTarget.querySelector('button');
            if (trigger && e.target !== trigger && !trigger.contains(e.target as Node)) {
              trigger.click();
            }
          }}
        >
          <span class="shrink-0 text-muted-foreground"
            >{m.onboarding_promptStep_branchOff_label()}</span
          >
          <BranchSelector
            variant="ghost"
            triggerClass="max-w-full pl-1 pr-1.5 font-medium bg-card/50 py-1.25 rounded-md border border-border"
            value={projectSelection.branch}
            repoPath={projectSelection.repoPath || ''}
            repoType="github"
            githubUrl={projectSelection.githubUrl}
            hasTriggerIcon={false}
            skipIsolation={onboardingSkipIsolation}
            {onSkipIsolationChange}
            onBranchStatusChange={(status) => {
              onBranchBehindChange(status.behind);
            }}
            onchange={(event) => {
              if (projectSelection) {
                onProjectChange({
                  ...projectSelection,
                  branch: event.detail.branch,
                });
              }
            }}
          />
        </div>
      {/if}

      <!-- Setup script disclosure -->
      {#if projectSelection?.repoPath && projectSelection?.type !== 'new'}
        {#if !hideSetupScriptControl}
          <div
            class="onboarding-metadata-row flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
            in:fly={{ y: 10, duration: 200, easing: cubicOut }}
          >
            <button
              type="button"
              class="flex min-h-8 min-w-0 max-w-full flex-wrap items-center gap-y-1 text-left text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onclick={() => onShowSetupScriptChange(!showSetupScript)}
            >
              <span>{m.onboarding_promptStep_setupEnvWith_before()}</span>
              <span
                class="max-w-full break-words rounded-md border border-border bg-card/50 px-1.5 py-1.25 font-medium text-foreground"
                >{setupScriptDisplayName(setupScriptName, setupScriptNameSource)}</span
              >
              <span class="text-muted-foreground"
                >{m.onboarding_promptStep_setupEnvWith_after()}</span
              >
            </button>
          </div>
        {/if}
        <SetupScriptModal
          bind:open={showSetupScript}
          repoPath={projectSelection.repoPath}
          githubUrl={projectSelection.type === 'github' ? projectSelection.githubUrl : null}
          {repoConfigScript}
          bind:value={setupScript}
          bind:scriptName={setupScriptName}
          bind:scriptNameSource={setupScriptNameSource}
          bind:isCustomScript={isCustomSetupScript}
          onClose={() => onShowSetupScriptChange(false)}
        />
      {/if}

      <!-- Model picker (initial Coordinator agent) -->
      <div
        class="onboarding-metadata-row flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
        in:fly={{ y: 10, duration: 200, easing: cubicOut }}
      >
        <span class="shrink-0 text-muted-foreground"
          >{m.onboarding_promptStep_usingModel_before()}</span
        >
        {#key coordinatorDefaultModel}
          <ModelPicker
            selectedModel={modelWasOverridden ? selectedModel : undefined}
            {onModelChange}
            variant="ghost"
            size="xs"
            triggerClass="max-w-full pl-1 pr-1.5 font-medium bg-card/50 py-1.25 rounded-md border border-border text-sm"
            defaultModelId={coordinatorDefaultModel}
            defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
            fallbackToCatalogDefault
            fallbackProviderId={onboardingProvider}
            silentFallback
          />
        {/key}
      </div>
    </div>

    <!-- Use PR branch suggestion -->
    {#if selectedPRBranch && projectSelection?.branch !== selectedPRBranch && projectSelection?.type !== 'new'}
      <div class="mt-1">
        <button
          class="flex items-center gap-2 mt-1 mb-1 px-1 text-sm text-primary hover:text-primary/80 cursor-pointer"
          transition:slide={{ axis: 'y', duration: 150 }}
          onclick={() => {
            if (projectSelection) {
              onProjectChange({
                ...projectSelection,
                branch: selectedPRBranch,
              });
            }
          }}
        >
          <Fa icon={faCodeBranch} size="sm" class="shrink-0" />
          <span
            >{m.onboarding_promptStep_usePrBranch_before()}
            <strong>{selectedPRBranch}</strong></span
          >
        </button>
      </div>
    {/if}

    <!-- Error state: post-submit error (user clicked Create and it failed). -->
    {#if onboardingCreationError}
      <WorkspaceCreationError
        message={onboardingCreationError}
        errorCode={onboardingCreationErrorCode}
        onRetry={handleSubmit}
      />
    {/if}

    <!-- Create button (blocked while the branch is unresolved, an image is
      still converting, or a staged pill is placing/failed) -->
    <div class="onboarding-create-action flex items-center gap-3 pt-2">
      <Button
        class="group/button"
        size="xl"
        variant={!onboardingInputValue.trim() ? 'outline' : 'default'}
        disabled={!onboardingInputValue.trim() ||
          !hasResolvedBranch ||
          isProcessingImages ||
          hasBlockingAttachments(stagedContextItems)}
        onclick={handleSubmit}
      >
        {m.onboarding_promptStep_createWorkspace_label()}
        {#if onboardingInputValue.trim()}
          <span class="mx-1 opacity-50" in:slide={{ axis: 'x', duration: 200 }}> ⌘↵</span>
        {/if}
        <Fa
          icon={faArrowRight}
          size={15}
          class="transform -translate-x-0.75 transition-all group-hover/button:translate-x-0 ml-1 opacity-50"
        />
      </Button>
    </div>
  {/if}
</div>
