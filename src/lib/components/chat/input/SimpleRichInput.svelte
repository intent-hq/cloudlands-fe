<script lang="ts">
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  /* eslint-disable max-lines */
  import { onMount, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { toast } from 'svelte-sonner';
  import { withToastCountdown } from '$lib/components/ui/toast';
  import { createLogger } from '$lib/utils/client-logger';
  import type { Workspace } from '$shared/types';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import {
    selectEffectiveDefaultProviderId,
    selectNormalizedProviderId,
    selectProviderDisplayName,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import {
    enhancePrompt,
    EnhancePromptUnavailableError,
    isEnhancePromptAvailable,
  } from '$lib/client/live/live-prompt-enhancement';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import TooltipRich from '$lib/components/ui/tooltip/TooltipRich.svelte';

  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';

  import { agentClient } from '$features/agent/agent.client';
  import { reconcileAgentReasoningEffort } from '$features/agent/reasoning-effort';
  import { selectModelEffortLevels } from '$store/renderer/slices/model/model-selectors';

  import { getAgentProvider } from '$shared/types/agent-session';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import {
    faMicrophone,
    faPaperclip,
    faArrowRight,
    faSpinner,
    faXmark,
    faStop,
    faPlus,
    faClock,
    faWandMagicSparkles,
    faRotateLeft,
    faAt,
  } from '$lib/icons/phosphor-icons';
  import {
    selectPttRecording,
    selectVoiceTranscribing,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import {
    cancelComposerMicRecording,
    isComposerMicRecording,
    toggleComposerMicRecording,
  } from '$features/hardware-console/voice/composer-mic-controller';
  import { cancelActiveTranscription } from '$features/hardware-console/voice/transcription-cancellation';
  import { showVoiceSetupToast } from '$features/hardware-console/voice/voice-setup-toast';
  import { selectEffectiveVoiceEngine } from '$store/renderer/slices/voice-settings/voice-settings-selectors';
  import type { PttContext } from '$features/hardware-console/voice/ptt-controller';
  import Button from '../../ui/button/button.svelte';
  import TipTapEditor from './TipTapEditor.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import ModelSwitchConfirmDialog from '../ModelSwitchConfirmDialog.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import AttachmentPreview from '../AttachmentPreview.svelte';
  import ContextChip from '../ContextChip.svelte';
  import ContextPickerButton from './ContextPickerButton.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import type { StackedMenuGroup } from '$lib/components/ui/menu';
  import { parseImageDataUrl } from './image-data-url';
  import {
    selectSkills,
    selectSkillsError,
    selectSkillsLoading,
  } from '$store/renderer/slices/skills/skills-selectors';

  import {
    togglePanel as togglePanelAction,
    toggleSelection as toggleSelectionAction,
  } from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';
  import {
    selectPanels,
    selectSelections,
  } from '$store/renderer/slices/multi-panel-context/multi-panel-context-selectors';

  import { slide } from 'svelte/transition';

  const logger = createLogger('SimpleRichInput');

  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const pttRecording$ = selectPttRecording();
  const voiceTranscribing$ = selectVoiceTranscribing();
  const effectiveVoiceEngine$ = selectEffectiveVoiceEngine();

  // Catalog-backed local shims for the legacy provider-config helpers.
  function normalizeProviderId(providerId: string): string {
    return selectNormalizedProviderId.select(appStore.state, providerId);
  }
  function providerDisplayName(providerId: string): string {
    return selectProviderDisplayName.select(appStore.state, providerId);
  }
  function parseCompoundModelId(compoundModelId: string): {
    providerId: string;
    modelId: string;
  } {
    const { providerId, modelId } = splitLegacyCompoundId(compoundModelId);
    return { providerId: providerId ?? $defaultProviderId$, modelId };
  }

  type MainPanelContext = {
    type: 'file' | 'note' | 'spec';
    path?: string;
    title?: string;
    noteId?: string;
    kind?: 'file' | 'note' | 'spec' | 'diff';
  };

  interface Props {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    editableWhileDisabled?: boolean;
    /**
     * Transient editor-only lock (e.g. an in-flight draft restore): the editor
     * rejects focus/typing and submit is blocked, but the action bar keeps its
     * normal enabled styling and the placeholder stays visible.
     */
    inputLocked?: boolean;
    workspace: Workspace | null;
    isStreaming?: boolean;
    /**
     * Canonical "agent is actively responding" signal — true during the
     * pre-first-chunk processing window in addition to active streaming.
     * Drives the Stop-button visibility so it matches the Thinking indicator.
     */
    isResponding?: boolean;
    contextItems?: ContextItem[];
    currentContext?: MainPanelContext | null;
    editorSelection?: string | null;
    selectedModel?: string | null;
    isModelLocked?: boolean;
    providerId?: string;
    /**
     * When true (conversation has started), a mid-conversation model/provider
     * switch must be confirmed via a warning dialog before it is applied.
     */
    requiresModelSwitchConfirmation?: boolean;
    agentId?: string;
    autoFocus?: boolean;
    /** Edit mode - shows cancel button and changes submit label */
    editMode?: boolean;
    /** Whether the parent panel is focused - dims action bar when false */
    panelFocused?: boolean;
    /** Whether to use compact mode (shorter height for short panels) */
    compactMode?: boolean;
    /** Render as the inset ChatPanel composer surface. */
    edgeDocked?: boolean;
    /** Padding/spacing class applied to the rich text editor content. */
    editorClassName?: string;
    /** Override the horizontal inset applied to context rows and the action bar. */
    contentInsetClassName?: string;
    /** Override the action bar's important trailing-edge padding (defaults to `pr-1.5!`). */
    actionBarEndClassName?: string;
    /**
     * The parent owns file drag-and-drop (e.g. ChatPanel's full-panel drop
     * target): the container's own drag handlers and drop overlay are disabled
     * so drag events bubble up, and the parent forwards dropped files via
     * `handleDroppedFiles()`.
     */
    externalDropTarget?: boolean;
    onsubmit?: (value: string) => void;
    onforcesubmit?: (value: string) => void; // Interrupt streaming and send immediately
    onenhance?: () => void | Promise<void>;
    onstop?: () => void;
    /** Cancel callback for edit mode */
    oncancel?: () => void;
    oncontextAdd?: (item: ContextItem) => void;
    oncontextRemove?: (id: string) => void;
    onmodelChange?: (modelId: string) => void;
    onvaluechange?: (value: string) => void;
    /** Callback to get previous history item (up arrow) - returns null if at start of history */
    onHistoryPrev?: () => string | null;
    /** Callback to get next history item (down arrow) - returns null if at end of history */
    onHistoryNext?: () => string | null;
  }

  // Import ContextItem from context-api.ts
  import { hasBlockingAttachments, type ContextItem } from './context-api';
  import {
    extractPlacementErrorDetail,
    isPlacementCancellation,
    isRemoteBackend,
    placeAttachmentViaTransport,
  } from './attachment-placement';
  import { splitDroppedItems } from '$lib/utils/drop-split';
  import { cn } from '$lib/utils';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    formatFileSize,
    imageFilesToContextItems,
    INLINE_IMAGE_MAX_BYTES,
    REFERENCE_IMAGE_MAX_BYTES,
  } from './image-context-items';
  export type { ContextItem };

  let {
    value = $bindable(''),
    placeholder = m.chat_richInput_askAnything_placeholder(),
    disabled = false,
    editableWhileDisabled = false,
    inputLocked = false,
    workspace,
    isStreaming = false,
    isResponding = false,
    contextItems = $bindable([]),

    currentContext: _currentContext, // Now using multi-panel-context Redux slice instead
    editorSelection = $bindable<string | null>(null),
    selectedModel: propSelectedModel,
    isModelLocked = false,
    providerId: propProviderId,
    requiresModelSwitchConfirmation = false,
    agentId,
    autoFocus = false,
    editMode = false,

    panelFocused = true,

    compactMode: _compactMode = false, // Reserved for future use
    edgeDocked = false,
    editorClassName = 'px-2!',
    contentInsetClassName = undefined,
    actionBarEndClassName = 'pr-1.5!',
    externalDropTarget = false,
    onsubmit,
    onforcesubmit,
    onenhance,
    onstop,
    oncancel,
    oncontextAdd,
    oncontextRemove,
    onmodelChange,
    onvaluechange,
    onHistoryPrev,
    onHistoryNext,
  }: Props = $props();

  function updateValue(nextValue: string) {
    value = nextValue;
    onvaluechange?.(nextValue);
  }

  // §5.31 gate — enhance is auggie-only; gated on the settings-derived
  // effective provider, matching the daemon's derivation.
  const enhanceAvailable = $derived(isEnhancePromptAvailable($defaultProviderId$));

  const contentInsetClasses = $derived(
    contentInsetClassName ?? (edgeDocked ? 'px-4 sm:px-6' : 'px-2'),
  );

  // Track if enhancement is in progress
  let isEnhancing = $state(false);
  let enhanceRequestId = $state(0); // Monotonic generation; cancellation advances it
  let enhancementUndoValue = $state<string | null>(null);
  let enhancedPromptValue = $state<string | null>(null);
  let tiptap: any = $state(null);
  let modelPickerRef: {
    open: () => void;
    clearFallbackWarning: () => void;
    clearPendingUpdate: () => void;
  } | null = $state(null);
  let contextPickerRef: { open: (anchor?: HTMLElement) => Promise<void> } | null = $state(null);
  // svelte-ignore state_referenced_locally -- intentional initial snapshots for transition detection.
  let previousDisabled = $state(disabled);
  // svelte-ignore state_referenced_locally -- intentional initial snapshots for transition detection.
  let previousInputLocked = $state(inputLocked);
  let hasInlineImages = $state(false);

  // Selector readables are created at component init; mirror the reactive prop
  // so a composer moved between workspaces follows that workspace's skill roster.
  // svelte-ignore state_referenced_locally -- intentional initial prop snapshot.
  const workspaceIdStore = writable(workspace?.id ?? '');
  $effect(() => {
    workspaceIdStore.set(workspace?.id ?? '');
  });
  const skills$ = selectSkills(workspaceIdStore);
  const skillsLoading$ = selectSkillsLoading(workspaceIdStore);
  const skillsError$ = selectSkillsError(workspaceIdStore);

  // Derived state: whether there's content to send (text, context items, or inline images).
  // Blocked while any attachment placement is in flight or failed — a failed
  // pill must be retried or removed before the message can go out.
  let canSend = $derived(
    (value.trim() || contextItems.length > 0 || hasInlineImages) &&
      !hasBlockingAttachments(contextItems),
  );

  // Separate image attachments from other context items for Slack-style layout
  // An item is an image attachment only if we can actually render a thumbnail:
  // - Has both imageData AND imageMimeType (base64 data URL), OR
  // - Has a File object with an image/* mime type
  const imageAttachments = $derived(
    contextItems.filter(
      (item) =>
        item.type === 'file' &&
        ((item.imageData && item.imageMimeType) ||
          (item.file && item.file.type?.startsWith('image/'))),
    ),
  );
  const nonImageItems = $derived(
    contextItems.filter(
      (item) =>
        !(
          item.type === 'file' &&
          ((item.imageData && item.imageMimeType) ||
            (item.file && item.file.type?.startsWith('image/')))
        ),
    ),
  );

  // The Stop affordance mirrors the Thinking indicator: visible for the entire
  // turn the agent is responding, not just while text chunks are streaming.
  // The broader "coordinator waiting on delegated children" state (PROTOCOL §5.5
  // isWaitingForOtherAgents) is intentionally NOT a Stop condition — there is
  // no turn to stop while a parent is idle-waiting, and that affordance lives
  // on sidebar/list surfaces (IDLE-1).
  let showStopButton = $derived(isStreaming || isResponding);
  const micRecording = $derived($pttRecording$ && isComposerMicRecording());
  const micTranscribing = $derived($voiceTranscribing$);

  const micContext: PttContext = {
    dispatch: (action) => appStore.dispatch(action as { type: string }),
    showHint: (message) => toast.info(message),
  };

  function handleMicClick() {
    if (!micRecording && selectEffectiveVoiceEngine.select(appStore.state) === 'unavailable') {
      showVoiceSetupToast();
      return;
    }
    toggleComposerMicRecording(micContext, agentId);
  }

  // Toolbar-button pattern: swallow mousedown's default action (focus) so
  // clicking the mic never blurs the editor — the caret stays in the input
  // across start/stop/cancel clicks. The click itself still fires.
  function handleMicMouseDown(event: MouseEvent) {
    event.preventDefault();
  }

  function handleMicEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !micRecording) return;
    if (cancelComposerMicRecording(micContext)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleMicCancelTranscription() {
    cancelActiveTranscription();
  }

  $effect(() => {
    const justEnabled = previousDisabled && !disabled;
    previousDisabled = disabled;

    if (justEnabled) {
      void tick().then(() => focus());
    }
  });

  // Mirror of the justEnabled effect for the transient editor lock: the
  // composer takes focus again as soon as the lock releases.
  $effect(() => {
    const justUnlocked = previousInputLocked && !inputLocked;
    previousInputLocked = inputLocked;

    if (justUnlocked) {
      void tick().then(() => focus());
    }
  });

  // Export focus method for parent components
  export async function focus(): Promise<boolean> {
    if (inputLocked) {
      return false;
    }

    if (disabled && !editableWhileDisabled) {
      return false;
    }

    if (tiptap?.focus) {
      const focused = tiptap.focus();
      if (focused) {
        return true;
      }
    }

    await tick();

    if (tiptap?.focus) {
      const focused = tiptap.focus();
      if (focused) {
        return true;
      }
    }

    return false;
  }

  // Export clear method for parent components
  export function clear() {
    if (tiptap?.clear) {
      tiptap.clear();
    }
    updateValue('');
    contextItems = [];
  }

  // Export setContent method for parent components (e.g., suggested prompts)
  export async function setContent(text: string) {
    updateValue(text);
    if (tiptap?.setContent) {
      await tiptap.setContent(text);
    }
  }

  /**
   * Get inline images from the editor as context items.
   * Call this before submitting to capture any images pasted inline.
   */
  export function getInlineImageContextItems(): ContextItem[] {
    const inlineImages = tiptap?.getInlineImages?.() ?? [];
    logger.info('SimpleRichInput: Getting inline images from editor', {
      inlineImageCount: inlineImages.length,
      inlineImageSources: inlineImages.map((img: { src: string; alt?: string }) => ({
        alt: img.alt,
        srcLength: img.src?.length || 0,
        isDataUrl: img.src?.startsWith('data:') || false,
      })),
    });

    return inlineImages
      .map((img: { src: string; alt?: string }, index: number) => {
        // Parse data URL to extract mime type and base64 data
        // NOTE: We use string operations instead of regex here because base64
        // data URLs can be multi-megabyte strings that cause stack overflows
        // in the regex engine when using capture groups like (.+)$.
        const src = img.src ?? '';
        if (!src.startsWith('data:')) {
          logger.warn('SimpleRichInput: Failed to parse image data URL', {
            index,
            alt: img.alt,
            srcLength: src.length,
          });
          return null;
        }
        const parsed = parseImageDataUrl(src);
        if (!parsed) {
          logger.warn('SimpleRichInput: Failed to parse image data URL', {
            index,
            alt: img.alt,
            srcLength: src.length,
          });
          return null;
        }
        const { mimeType, data: base64Data } = parsed;
        logger.info('SimpleRichInput: Parsed inline image', {
          index,
          mimeType,
          dataLength: base64Data.length,
        });
        return {
          id: `inline-image-${Date.now()}-${index}`,
          type: 'file' as const,
          label: img.alt || `Image ${index + 1}`,
          description: mimeType,
          imageData: base64Data,
          imageMimeType: mimeType,
        };
      })
      .filter(Boolean) as ContextItem[];
  }

  /**
   * Get file/folder/note mentions from the editor as context items.
   * Call this before submitting to capture @-mentioned files so the backend
   * receives their paths as context references.
   */
  export function getMentionContextItems(): ContextItem[] {
    const mentions = tiptap?.getMentions?.() ?? [];
    return mentions
      .filter((m: { type: string }) => m.type === 'file' || m.type === 'folder')
      .map(
        (
          m: {
            id: string;
            label: string;
            type: string;
            uri: string;
            meta?: Record<string, unknown>;
          },
          index: number,
        ) => ({
          id: `mention-${Date.now()}-${index}`,
          type: 'file' as const,
          label: m.label,
          path: (m.meta?.fullPath as string) || (m.meta?.path as string) || m.label,
        }),
      );
  }

  let fileInput: HTMLInputElement;

  // Track dismissed main panel context - stores a key that identifies the dismissed context
  // When the main panel changes to something different, we reset this to show the new context
  // Multi-panel context store data (Redux selectors as Svelte readables)
  const panelsReadable = selectPanels();
  const selectionsReadable = selectSelections();
  let availablePanels = $derived($panelsReadable);
  let availableSelections = $derived($selectionsReadable);

  // Handlers for picker buttons
  function handleTogglePanel(id: string) {
    appStore.dispatch(togglePanelAction(id));
  }

  function handleToggleSelection(id: string) {
    appStore.dispatch(toggleSelectionAction(id));
  }

  // Resize functionality
  let isResizing = $state(false);
  let containerHeight = $state<number | null>(null); // null = use auto-expand mode
  let isComposerFocused = $state(false);
  let initialY = 0;
  let initialHeight = 0;

  // Track parent panel height for max height calculation
  let parentPanelHeight = $state<number | null>(null);
  let containerRef = $state<HTMLDivElement | null>(null);

  // Height constraints for auto-expand
  const MIN_HEIGHT = 65;
  const IDLE_MIN_HEIGHT = 56;
  const DEFAULT_HEIGHT = 100;
  const IDLE_DEFAULT_HEIGHT = 80;
  const COMPACT_PANEL_THRESHOLD = 640; // Keep the composer compact in short and stacked panels
  const MAX_HEIGHT_PERCENTAGE = 0.8; // Max 80% of parent panel
  const MAX_HEIGHT_ABSOLUTE = 800; // Absolute max in pixels
  const FALLBACK_MAX_HEIGHT = 300;

  const hasComposerContent = $derived(
    value.trim().length > 0 || contextItems.length > 0 || hasInlineImages,
  );
  const showPlaceholder = $derived(inputLocked || (isComposerFocused && !hasComposerContent));

  // Automatic geometry expands only for real composer content. Focus reveals
  // the placeholder without changing the compact idle height.
  let dynamicDefaultHeight = $derived.by(() => {
    if (parentPanelHeight && parentPanelHeight > COMPACT_PANEL_THRESHOLD) {
      return hasComposerContent ? DEFAULT_HEIGHT : IDLE_DEFAULT_HEIGHT;
    }
    return hasComposerContent ? MIN_HEIGHT : IDLE_MIN_HEIGHT;
  });

  // Calculate max height based on parent panel (80% of panel height, capped)
  let maxAutoHeight = $derived.by(() => {
    if (parentPanelHeight && parentPanelHeight > 0) {
      const percentageHeight = Math.floor(parentPanelHeight * MAX_HEIGHT_PERCENTAGE);
      return Math.min(percentageHeight, MAX_HEIGHT_ABSOLUTE);
    }
    return FALLBACK_MAX_HEIGHT;
  });

  // When user manually resizes, we use their height; otherwise auto-expand
  let isAutoExpand = $derived(containerHeight === null);

  // Model selection
  // svelte-ignore state_referenced_locally -- intentional initial snapshot; later prop changes sync below.
  let selectedModel = $state<string | null | undefined>(propSelectedModel);

  // Track the last notified model to prevent infinite loops
  // svelte-ignore state_referenced_locally -- tracks the initial notification baseline.
  let lastNotifiedModel: string | null | undefined = propSelectedModel;

  // Track if user has made a local change that should take precedence over props
  let userChangedModel = $state(false);

  // Update internal model when prop changes (but only if user hasn't made a local change)
  $effect(() => {
    if (propSelectedModel !== selectedModel && !userChangedModel) {
      selectedModel = propSelectedModel;
      lastNotifiedModel = propSelectedModel;
    }
    // Reset the flag when prop catches up to our local change
    if (propSelectedModel === selectedModel) {
      userChangedModel = false;
    }
  });

  // Update parent when model changes internally (via binding, not callback)
  // Note: The onModelChange callback in the ModelPicker sets userChangedModel directly
  $effect(() => {
    if (selectedModel && onmodelChange && selectedModel !== lastNotifiedModel) {
      lastNotifiedModel = selectedModel;
      onmodelChange(selectedModel);
    }
  });

  const hydratedPropProviderId = $derived.by(() => {
    if (propProviderId) {
      return normalizeProviderId(propProviderId);
    }

    if (!agentId) {
      return $defaultProviderId$;
    }

    const session = workspace?.id ? selectAgentSession.select(appStore.state, agentId) : undefined;
    const provider = session ? getAgentProvider(session, $defaultProviderId$) : undefined;
    return provider ? normalizeProviderId(provider) : undefined;
  });
  let localProviderId = $state<string | undefined>(undefined);

  $effect(() => {
    if (localProviderId && hydratedPropProviderId === localProviderId) {
      localProviderId = undefined;
    }
  });

  const selectedProviderId = $derived.by(() => {
    return localProviderId || hydratedPropProviderId;
  });

  let isChangingProvider = $state(false);

  // Mid-conversation switch confirmation dialog state. The pending resolver
  // settles the promise returned to ModelPicker's confirmModelChange gate.
  let modelSwitchDialog = $state<{
    isProviderChange: boolean;
    fromModelLabel: string;
    toModelLabel: string;
    fromProviderName: string;
    toProviderName: string;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  function describeModelForDialog(model: string | null | undefined): {
    modelLabel: string;
    providerName: string;
    providerId: string;
  } {
    if (!model) {
      const provider = selectedProviderId || $defaultProviderId$;
      return {
        modelLabel: m.chat_richInput_defaultModel_label(),
        providerName: providerDisplayName(provider),
        providerId: normalizeProviderId(provider),
      };
    }
    // Bare (non-compound) ids belong to the agent's current provider, not the
    // default provider parseCompoundModelId falls back to.
    const rawProvider = model.includes(':')
      ? parseCompoundModelId(model).providerId
      : selectedProviderId || $defaultProviderId$;
    return {
      modelLabel: parseCompoundModelId(model).modelId,
      providerName: providerDisplayName(rawProvider),
      providerId: normalizeProviderId(rawProvider),
    };
  }

  function confirmModelSwitch(
    from: string | null | undefined,
    to: string | null,
  ): boolean | Promise<boolean> {
    if (!requiresModelSwitchConfirmation) return true;

    // Settle any previously pending dialog so its awaiter never hangs.
    modelSwitchDialog?.resolve(false);
    const fromInfo = describeModelForDialog(from);
    const toInfo = describeModelForDialog(to);
    return new Promise<boolean>((resolve) => {
      modelSwitchDialog = {
        // Compare normalized provider ids, not display names — unknown ids
        // fall back to the default config's display name and would misclassify
        // a cross-provider switch as model-only.
        isProviderChange: fromInfo.providerId !== toInfo.providerId,
        fromModelLabel: fromInfo.modelLabel,
        toModelLabel: toInfo.modelLabel,
        fromProviderName: fromInfo.providerName,
        toProviderName: toInfo.providerName,
        resolve,
      };
    });
  }

  function settleModelSwitchDialog(confirmed: boolean) {
    modelSwitchDialog?.resolve(confirmed);
    modelSwitchDialog = null;
  }

  async function handleProviderChangeFromModel(newProvider: string, newModel: string) {
    if (!agentId || !workspace?.id) return;
    if (isChangingProvider) return; // prevent re-entry during in-flight switch

    const previousSession =
      agentId && workspace?.id ? selectAgentSession.select(appStore.state, agentId) : undefined;
    const previousProvider = selectedProviderId;
    const previousModel = selectedModel;

    isChangingProvider = true;
    localProviderId = newProvider;
    userChangedModel = true;
    selectedModel = newModel;
    lastNotifiedModel = newModel;

    appStore.dispatch(
      updateAgentSessionFields(agentId, {
        provider: newProvider,
        model: newModel,
        metadata: {
          ...(previousSession?.metadata || {}),
          provider: newProvider,
        },
      }),
    );

    try {
      // Pass the target provider explicitly so the daemon resolves a bare
      // modelId against it instead of the session's current provider.
      const result = await agentClient.setModel(agentId, newModel, workspace.id, newProvider);
      if (!result.ok || !result.data.success) {
        throw new Error(result.ok ? result.data.error : result.error);
      }
      const supportedEfforts = selectModelEffortLevels.select(appStore.state, newModel);
      await reconcileAgentReasoningEffort(
        agentId,
        workspace.id,
        previousSession?.reasoningEffort,
        supportedEfforts,
      );
      onmodelChange?.(newModel);
    } catch (error) {
      logger.error('Failed to switch agent provider via model change', {
        error,
        agentId,
        newProvider,
      });
      localProviderId = previousProvider === hydratedPropProviderId ? undefined : previousProvider;
      selectedModel = previousModel;
      lastNotifiedModel = previousModel;
      userChangedModel = false;
      const rollbackProvider =
        previousProvider ??
        previousSession?.provider ??
        (previousSession?.metadata?.provider as string | undefined);
      const rollbackModel = previousModel ?? previousSession?.model;
      if (rollbackProvider && rollbackModel) {
        appStore.dispatch(
          updateAgentSessionFields(agentId, {
            provider: rollbackProvider,
            model: rollbackModel,
            metadata: {
              ...(previousSession?.metadata || {}),
              provider: rollbackProvider,
            },
          }),
        );
      }
      toast.error(
        error instanceof Error
          ? error.message
          : m.chat_richInput_switchFailed_error({
              provider: providerDisplayName(newProvider),
            }),
      );
    } finally {
      modelPickerRef?.clearPendingUpdate();
      isChangingProvider = false;
    }
  }

  /**
   * In-flight placement cancellers keyed by context-item id. Removing an
   * attachment mid-upload aborts the transfer (and the daemon-side staged
   * session) instead of letting it commit after the pill disappeared.
   * Transient UI-only state — never Redux.
   */
  const placementAborters = new Map<string, AbortController>();

  function removeContextItem(id: string) {
    placementAborters.get(id)?.abort();
    placementAborters.delete(id);
    contextItems = contextItems.filter((item) => item.id !== id);
    oncontextRemove?.(id);
  }

  function handleSubmit() {
    if (!canSend || disabled || inputLocked || isEnhancing) {
      return;
    }
    handleCancelEnhance();
    // Clear any model fallback warning since user is sending a message with the new model
    modelPickerRef?.clearFallbackWarning();
    // Allow submission even if processing - the parent will handle stopping the current message
    onsubmit?.(value);
  }

  function handleForceSubmit() {
    if (!canSend || disabled || inputLocked || isEnhancing) {
      return;
    }
    handleCancelEnhance();
    // Force submit interrupts streaming and sends immediately
    onforcesubmit?.(value);
  }

  async function handleEnhancePrompt() {
    if (!enhanceAvailable || disabled) return;
    if (!value.trim() || isEnhancing) return;

    const originalPrompt = value;
    enhancementUndoValue = null;
    enhancedPromptValue = null;
    isEnhancing = true;
    const currentRequestId = ++enhanceRequestId;

    try {
      // Call the enhance handler if provided
      if (onenhance) {
        await onenhance();
      } else {
        // No handler provided: enhance through the daemon (agent.enhancePrompt, PROTOCOL §5.31)
        const result = await enhancePrompt(value, { model: selectedModel ?? undefined });

        // Only the latest, still-active request may update the prompt.
        if (currentRequestId !== enhanceRequestId) {
          return;
        }

        enhancementUndoValue = originalPrompt;
        enhancedPromptValue = result.enhanced;
        updateValue(result.enhanced);
        // Capture THIS enhancement's undo state in the closure: a lingering
        // toast's Undo must not revert a newer enhancement (or a cancelled
        // one) based on whatever the component state holds at click time.
        const undoValueForToast = originalPrompt;
        const enhancedValueForToast = result.enhanced;
        toast.success(
          m.chat_richInput_promptEnhanced_toast(),
          withToastCountdown({
            duration: 10000,
            action: {
              label: m.chat_richInput_undoEnhance_label(),
              onClick: () => {
                if (
                  enhancementUndoValue !== undoValueForToast ||
                  enhancedPromptValue !== enhancedValueForToast
                ) {
                  return;
                }
                handleUndoEnhance();
              },
            },
          }),
        );
      }
    } catch (error) {
      // Ignore errors from requests invalidated by cancellation or a newer request.
      if (currentRequestId !== enhanceRequestId) {
        return;
      }
      logger.error('Failed to enhance prompt:', error);
      toast.error(
        error instanceof EnhancePromptUnavailableError
          ? m.chat_richInput_enhanceUnavailable_error()
          : error instanceof Error && error.message
            ? m.chat_richInput_enhanceFailedDetail_error({ detail: error.message })
            : m.chat_richInput_enhanceFailed_error(),
      );
    } finally {
      if (currentRequestId === enhanceRequestId) {
        isEnhancing = false;
      }
    }
  }

  function handleCancelEnhance() {
    if (isEnhancing) {
      enhanceRequestId += 1;
      isEnhancing = false;
      enhancementUndoValue = null;
      enhancedPromptValue = null;
    }
  }

  function handleUndoEnhance() {
    if (enhancementUndoValue === null) return;
    const originalPrompt = enhancementUndoValue;
    enhancementUndoValue = null;
    enhancedPromptValue = null;
    updateValue(originalPrompt);
    void tick().then(() => focus());
  }

  function handleFileSelect() {
    fileInput?.click();
  }

  async function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    await processImageFiles(Array.from(files));

    // Reset the input
    target.value = '';
  }

  // Drag and drop state
  let isDragging = $state(false);
  let dragCounter = $state(0);

  // Handle drag events for file drop
  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer?.types.includes('Files')) {
      isDragging = true;
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      isDragging = false;
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    dragCounter = 0;

    // Folder detection must happen HERE, synchronously in the drop event —
    // webkitGetAsEntry() returns null once the event loop turns.
    const { files, folderFiles } = splitDroppedItems(e.dataTransfer);
    if (files.length === 0 && folderFiles.length === 0) return;

    await handleDroppedFiles({ files, folderFiles });
  }

  // Export for parents that own the drop target (externalDropTarget, e.g.
  // ChatPanel's full-panel drop zone) — forwards dropped files into the same
  // attach pipeline as a direct drop on the input. Accepts either a plain
  // File[] (legacy callers, no folder info) or a DropSplit captured at drop
  // time — folder entries are only detectable inside the drop event, so the
  // split travels with the files.
  export async function handleDroppedFiles(
    dropped: File[] | { files: File[]; folderFiles: File[] },
  ) {
    const { files, folderFiles } = Array.isArray(dropped)
      ? { files: dropped, folderFiles: [] }
      : dropped;
    if (files.length === 0 && folderFiles.length === 0) return;

    if (folderFiles.length > 0) {
      // Folders are path-only references — the agent reads them off the
      // host filesystem, which a remote daemon cannot do. Any folder in the
      // drop rejects the WHOLE drop when remote (files included).
      if (isRemoteBackend()) {
        toast.error(m.chat_richInput_folderDropRemote_error());
        return;
      }
      for (const folder of folderFiles) {
        addFolderReference(folder);
      }
    }
    if (files.length > 0) {
      await processImageFiles(files);
    }
  }

  /**
   * Add a dropped folder as a path-only reference (local daemon only) —
   * the same folder-mention chip an @-mention inserts, so the send path
   * serializes the absolute host path into the message the same way
   * (`toPromptToken` folder case) and `getMentionContextItems()` carries it
   * as a context item. Never placed via `file.placeAttachment` (the daemon
   * rejects directories).
   *
   * The whole feature is predicated on the absolute host path: when the
   * Electron `getPathForFile` bridge is unavailable or returns '' (e.g.
   * dev:web), the folder is SKIPPED with a toast — a bare folder name would
   * serialize as a workspace-relative-looking mention that silently resolves
   * to the wrong directory (or nothing) on the daemon side.
   */
  function addFolderReference(folder: File) {
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
    // Windows-aware basename fallback ('\' or '/' separators).
    const label = folder.name || absolutePath.split(/[/\\]/).pop() || absolutePath;
    tiptap?.insertMention?.({
      // Same id convention as folder @-mentions (mention-system providers):
      // path-keyed, so two dropped folders sharing a basename stay distinct.
      id: `folder-${absolutePath}`,
      label,
      type: 'folder',
      uri: `devspace://folder/${encodeURIComponent(absolutePath)}`,
      meta: { path: absolutePath, fullPath: absolutePath },
    });
  }

  // Handle clipboard paste for files (images and non-images alike)
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

  /**
   * Process dropped/pasted files: images become context items (attachment
   * flow), non-image files are placed into the workspace via the daemon.
   */
  async function processImageFiles(files: File[]) {
    // Images travel as attachment-reference blocks (monorepo#3338), so the
    // composer cap matches the daemon's 30 MiB reference-image limit. The
    // chief virtual workspace has no attachment registry — its images stay
    // inline, so it keeps the legacy 10 MB inline-frame cap.
    const maxBytes =
      workspace?.id === CHIEF_WORKSPACE_ID ? INLINE_IMAGE_MAX_BYTES : REFERENCE_IMAGE_MAX_BYTES;

    const imageFiles: File[] = [];
    for (const file of files) {
      // Non-image files of ANY size are placed into the workspace via the
      // daemon (file.placeAttachment, PROTOCOL §5.9) and referenced by an
      // attachment block — never inlined, never dropped.
      if (!file.type.startsWith('image/')) {
        await placeNonImageFile(file);
        continue;
      }
      imageFiles.push(file);
    }

    for (const item of await imageFilesToContextItems(imageFiles, { maxBytes })) {
      contextItems = [...contextItems, item];
      oncontextAdd?.(item);
    }
  }

  /**
   * Place a non-image attachment of any size into the workspace via the
   * daemon (`file.placeAttachment`, PROTOCOL §5.9) and hold the returned
   * `attachmentId` + metadata on a context item. The send path builds an
   * attachment-reference file block from the item — no bytes, no mentions,
   * no host paths in the message.
   *
   * Placement is sourcePath-only (never base64): the item is added
   * immediately in the `placing` state, then flips to `placed` or `failed`.
   * A failed item shows a retry affordance in the pill and blocks send until
   * retried or removed.
   */
  async function placeNonImageFile(file: File) {
    const fileName =
      file.name === 'image.png' || file.name === 'image.jpg' || !file.name
        ? `pasted-file-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
        : file.name;

    const sourcePath =
      (
        window as unknown as { electronAPI?: { getPathForFile?: (f: File) => string } }
      ).electronAPI?.getPathForFile?.(file) ?? '';

    const mimeType = file.type || undefined;
    const itemId = `attachment-pending-${Date.now()}-${fileName}`;
    const contextItem: ContextItem = {
      id: itemId,
      type: 'file',
      label: fileName,
      description: m.chat_richInput_fileTypeSize_description({
        type: file.type || m.chat_richInput_unknownType_fallback(),
        size: formatFileSize(file.size),
      }),
      path: fileName,
      attachmentMimeType: mimeType,
      attachmentSize: file.size,
      placementStatus: 'placing',
      sourcePath,
    };
    contextItems = [...contextItems, contextItem];

    await runPlacement(itemId);
  }

  /**
   * Run (or re-run, on retry) `file.placeAttachment` for a staged context
   * item using its captured `sourcePath` (transport-aware: the data arm
   * carries the bytes when the backend is remote). Mutates the item's
   * placement status in place: `placing` → `placed` (with attachment
   * metadata) or `failed` (pill shows retry; send stays blocked).
   */
  async function runPlacement(itemId: string) {
    const item = contextItems.find((i) => i.id === itemId);
    if (!item) return;

    const patchItem = (patch: Partial<ContextItem>) => {
      contextItems = contextItems.map((i) => (i.id === itemId ? { ...i, ...patch } : i));
    };

    if (!workspace?.id || !item.sourcePath) {
      // No resolvable source path (e.g. pasted bytes without a backing file)
      // or no workspace — placement cannot proceed without a source to read.
      logger.error('Attachment placement not possible', {
        fileName: item.label,
        hasWorkspace: !!workspace?.id,
        hasSourcePath: !!item.sourcePath,
      });
      patchItem({ placementStatus: 'failed' });
      toast.error(m.chat_richInput_attachmentPlaceFailed_error({ name: item.label }));
      return;
    }

    patchItem({
      placementStatus: 'placing',
      placementError: undefined,
      placementProgress: undefined,
    });
    const aborter = new AbortController();
    placementAborters.set(itemId, aborter);
    try {
      const result = await placeAttachmentViaTransport(
        workspace.id,
        item.label,
        {
          sourcePath: item.sourcePath,
          mimeType: item.attachmentMimeType,
        },
        (fraction) => patchItem({ placementProgress: fraction }),
        aborter.signal,
      );

      patchItem({
        placementStatus: 'placed',
        placementProgress: undefined,
        label: result.fileName,
        path: result.path,
        attachmentId: result.attachmentId,
        attachmentMimeType: result.mimeType ?? item.attachmentMimeType,
        attachmentSize: result.size,
      });
      const placed = contextItems.find((i) => i.id === itemId);
      if (placed) oncontextAdd?.(placed);
      logger.debug('Placed attachment in workspace', {
        fileName: result.fileName,
        attachmentId: result.attachmentId,
        size: result.size,
      });
      toast.success(m.chat_richInput_addedFile_toast({ name: result.fileName }));
    } catch (error) {
      if (isPlacementCancellation(error, aborter.signal)) {
        // User removed the attachment mid-upload — the item is already gone
        // and the daemon session was aborted; no failure UI.
        logger.debug('Attachment placement cancelled', { fileName: item.label });
        return;
      }
      logger.error('Failed to place attachment', { fileName: item.label, error });
      const detail = extractPlacementErrorDetail(error);
      patchItem({
        placementStatus: 'failed',
        placementError: detail,
        placementProgress: undefined,
      });
      toast.error(
        detail
          ? m.chat_richInput_attachmentPlaceFailedDetail_error({ name: item.label, detail })
          : m.chat_richInput_attachmentPlaceFailed_error({ name: item.label }),
      );
    } finally {
      placementAborters.delete(itemId);
    }
  }

  // Set up ResizeObserver to track parent panel height. The observer delivers
  // an initial callback on observe() with the current size, so no synchronous
  // clientHeight read (forced reflow) is needed here — and the effect must not
  // read parentPanelHeight, or every resize would tear down and recreate it.
  $effect(() => {
    if (!containerRef) return;

    const parentPanel = containerRef.closest('.group\\/panel') as HTMLElement | null;
    if (!parentPanel) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === parentPanel) {
          parentPanelHeight = entry.contentRect.height;
        }
      }
    });
    resizeObserver.observe(parentPanel);

    return () => {
      resizeObserver.disconnect();
    };
  });

  onMount(() => {
    // Note: Selection changes from editors (CodeEditor/Monaco) are synced to the
    // multi-panel-context Redux store via ChatPanel which watches editor:selection-change events.
  });

  // Listen for global model picker shortcut (Cmd+Alt+.)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenModelPicker = () => {
      if (!panelFocused) return;
      modelPickerRef?.open();
    };

    window.addEventListener('chat:open-model-picker', handleOpenModelPicker);

    return () => {
      window.removeEventListener('chat:open-model-picker', handleOpenModelPicker);
    };
  });

  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleEnhancePromptEvent = () => {
      if (panelFocused) void handleEnhancePrompt();
    };
    const handleAttachContextEvent = () => {
      if (panelFocused && containerRef) void contextPickerRef?.open(containerRef);
    };
    const handleAttachFilesEvent = () => {
      if (panelFocused) handleFileSelect();
    };

    window.addEventListener('chat:enhance-prompt', handleEnhancePromptEvent);
    window.addEventListener('chat:attach-context', handleAttachContextEvent);
    window.addEventListener('chat:attach-files', handleAttachFilesEvent);

    return () => {
      window.removeEventListener('chat:enhance-prompt', handleEnhancePromptEvent);
      window.removeEventListener('chat:attach-context', handleAttachContextEvent);
      window.removeEventListener('chat:attach-files', handleAttachFilesEvent);
    };
  });

  // Track the last owning workspace ID for local change detection.
  let lastWorkspaceId = $state<string | undefined>(undefined);

  // Keep the local workspace snapshot aligned with the owning component prop;
  // workspace identity is supplied by the route/component boundary.
  $effect(() => {
    if (workspace?.id && workspace.id !== lastWorkspaceId) {
      lastWorkspaceId = workspace.id;
    }
  });

  // Resize handlers - double-click to reset to auto-expand mode
  function handleResizeDoubleClick() {
    containerHeight = null; // Reset to auto-expand mode
  }

  function startResize(e: MouseEvent) {
    isResizing = true;
    initialY = e.clientY;
    // Use current rendered height as starting point
    initialHeight = containerRef?.offsetHeight ?? MIN_HEIGHT;
    e.preventDefault();
  }

  function handleResize(e: MouseEvent) {
    if (!isResizing) return;

    // In edit mode, handle is at bottom so dragging down increases height
    // Otherwise, handle is at top so dragging up increases height
    const deltaY = editMode ? e.clientY - initialY : initialY - e.clientY;
    const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT_ABSOLUTE, initialHeight + deltaY));
    containerHeight = newHeight;
  }

  function stopResize() {
    isResizing = false;
  }

  function handleFocusIn() {
    isComposerFocused = true;
  }

  function handleFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !containerRef?.contains(nextTarget)) {
      isComposerFocused = false;
    }
  }

  // Add global mouse event listeners for resize
  $effect(() => {
    if (isResizing) {
      const handleMouseMove = (e: MouseEvent) => handleResize(e);
      const handleMouseUp = () => stopResize();

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  });

  const promptActionGroups = $derived.by((): StackedMenuGroup[] => {
    const groups: StackedMenuGroup[] = [
      {
        id: 'context',
        items: [
          {
            id: 'add-context',
            icon: faAt,
            label: m.chat_contextPicker_addContext_ariaLabel(),
            shortcut: '@',
            onSelect: (event) => {
              void contextPickerRef?.open(event.currentTarget as HTMLElement);
            },
          },
          {
            id: 'attach-files',
            icon: faPaperclip,
            label: m.chat_richInput_attachFiles_label(),
            shortcut: '⇧⌘A',
            onSelect: handleFileSelect,
          },
        ],
      },
    ];

    if (enhanceAvailable) {
      groups.push({
        id: 'enhance',
        items: [
          isEnhancing
            ? {
                id: 'stop-enhancing',
                icon: faXmark,
                label: m.chat_richInput_stopEnhancing_label(),
                shortcut: 'Esc',
                onSelect: handleCancelEnhance,
              }
            : enhancementUndoValue !== null
              ? {
                  id: 'undo-enhance',
                  icon: faRotateLeft,
                  label: m.chat_richInput_undoEnhance_label(),
                  onSelect: handleUndoEnhance,
                }
              : {
                  id: 'enhance-prompt',
                  icon: faWandMagicSparkles,
                  label: m.chat_richInput_enhancePrompt_label(),
                  shortcut: '⌘/',
                  disabled: value.trim().length < 3,
                  onSelect: () => void handleEnhancePrompt(),
                },
        ],
      });
    }

    return groups;
  });
</script>

<svelte:window onkeydowncapture={handleMicEscape} />

<div
  bind:this={containerRef}
  class={cn(
    'relative rich-input-container flex flex-col overflow-hidden text-card-foreground duration-(--motion-fast) ease-(--ease-standard) motion-reduce:transition-none',
    isAutoExpand
      ? 'transition-[border-color,background-color,box-shadow,min-height]'
      : 'transition-[border-color,background-color,box-shadow]',
    edgeDocked
      ? 'rounded-lg border-0 bg-sidebar shadow-none'
      : 'rounded-lg border border-border shadow-(--elevation-raised) focus-within:border-ring focus-within:ring-0',
    {
      'border-primary border-dashed': isDragging,
    },
  )}
  style={isAutoExpand
    ? `min-height: ${dynamicDefaultHeight}px; max-height: ${maxAutoHeight}px;`
    : `height: ${containerHeight}px;`}
  ondragenter={externalDropTarget ? undefined : handleDragEnter}
  ondragleave={externalDropTarget ? undefined : handleDragLeave}
  ondragover={externalDropTarget ? undefined : handleDragOver}
  ondrop={externalDropTarget ? undefined : handleDrop}
  onpaste={handlePaste}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
  role="region"
  aria-label={m.chat_richInput_dropSupport_ariaLabel()}
  data-testid="message-input"
>
  <!-- Drop zone overlay -->
  {#if isDragging}
    <div
      class="absolute inset-0 bg-primary/5 z-20 flex items-center justify-center pointer-events-none"
    >
      <div class="flex flex-col items-center gap-2 text-primary">
        <Fa icon={faPaperclip} class="w-6 h-6" />
        <span class="text-sm font-medium">{m.chat_richInput_dropFiles_label()}</span>
      </div>
    </div>
  {/if}

  <!-- Resize Handle - at bottom when in edit mode, top otherwise. Double-click to reset to auto-expand -->
  <button
    class="app-resize-handle resize-handle absolute left-1/2 z-10 h-4 w-12 -translate-x-1/2 opacity-0 pointer-events-none group-[.focused]/panel:opacity-100 group-[.focused]/panel:pointer-events-auto {editMode
      ? 'bottom-[-0.5px] translate-y-1/2'
      : 'top-[-0.5px] -translate-y-1/2'}"
    data-resize-axis="y"
    data-resize-indicator="short"
    data-resizing={isResizing}
    onmousedown={startResize}
    ondblclick={handleResizeDoubleClick}
    aria-label={m.chat_richInput_resize_ariaLabel()}
    tabindex="-1"
  ></button>

  <!-- Non-image context items and selections - shown above editor when present -->
  {#if nonImageItems.length > 0}
    <div
      class="flex min-w-0 items-center gap-1 overflow-x-auto pt-1 scrollbar-none {contentInsetClasses}"
      style="-ms-overflow-style: none; scrollbar-width: none;"
    >
      {#each nonImageItems as item (item.id)}
        {#if item.type === 'selection' && item.content}
          <TooltipRich side="top" align="start" maxWidth="24rem" delayDuration={300}>
            {#snippet children()}
              <ContextChip
                type="selection"
                label={item.label}
                maxLabelWidth="120px"
                removable
                onRemove={() => removeContextItem(item.id)}
              />
            {/snippet}
            {#snippet content()}
              <Header size={6}>{m.chat_richInput_selectedText_label()}</Header>
              <div class="mt-1 text-xs whitespace-pre-wrap max-w-80 overflow-auto line-clamp-6">
                {item.content}
              </div>
            {/snippet}
          </TooltipRich>
        {:else if item.type === 'file' && (item.file || item.imageData || item.attachmentId || item.placementStatus)}
          <!-- Non-image file with chip preview (placed attachments render
               from their registry metadata — no File handle, no bytes).
               Staged/placing/failed items render their placement state. -->
          <AttachmentPreview
            id={item.id}
            name={item.label}
            type={item.file?.type || item.imageMimeType || item.attachmentMimeType || ''}
            size={item.file?.size ?? item.attachmentSize}
            file={item.file}
            imageData={item.imageData}
            imageMimeType={item.imageMimeType}
            onRemove={removeContextItem}
            placementStatus={item.placementStatus}
            placementProgress={item.placementProgress}
            placementError={item.placementError}
            onRetry={(id) => void runPlacement(id)}
            variant="chip"
          />
        {:else}
          <!-- Other context items (notes, folders, etc.) -->
          <ContextChip
            type={item.type}
            label={item.label}
            maxLabelWidth="120px"
            removable
            onRemove={() => removeContextItem(item.id)}
          />
        {/if}
      {/each}
    </div>
  {/if}

  <!-- TipTap Editor replacing textarea so mentions render as pills -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="editor-wrapper relative min-h-0 cursor-text pt-1 {isAutoExpand
      ? 'flex-1 overflow-y-auto'
      : 'flex-1 overflow-hidden'} {editMode ? 'pr-5' : ''}"
    class:placeholder-hidden={!showPlaceholder}
    onclick={() => tiptap?.focus()}
  >
    <TipTapEditor
      bind:this={tiptap}
      class={isAutoExpand ? '' : 'h-full overflow-y-auto'}
      {editorClassName}
      minHeight={20}
      maxHeight={isAutoExpand ? 9999 : 9999}
      {autoFocus}
      {value}
      {placeholder}
      disabled={disabled || isEnhancing}
      editableWhileDisabled={editableWhileDisabled && !isEnhancing}
      {inputLocked}
      workspace={workspace ?? undefined}
      skills={$skills$}
      skillsLoading={$skillsLoading$}
      skillsError={$skillsError$}
      onUpdate={(text) => {
        handleCancelEnhance();
        if (
          enhancementUndoValue !== null &&
          enhancedPromptValue !== null &&
          text !== enhancedPromptValue
        ) {
          enhancementUndoValue = null;
          enhancedPromptValue = null;
        }
        updateValue(text);
        // Update inline images state for send button reactivity
        hasInlineImages = (tiptap?.getInlineImages?.() ?? []).length > 0;
      }}
      onSubmit={handleSubmit}
      onForceSubmit={handleForceSubmit}
      onEscape={isEnhancing ? handleCancelEnhance : editMode ? oncancel : undefined}
      {onHistoryPrev}
      {onHistoryNext}
      onSelectionChange={(selectedText) => (editorSelection = selectedText)}
      onMentionSelect={(item) => {
        // Mentions are already rendered as chips in the editor
        // Don't add them to the context header - that's only for:
        // - Currently open file/note in main panel
        // - Selected text
        // Just log for debugging
        logger.debug('Mention selected:', item);
      }}
    />

    {#if isEnhancing}
      <div class="shimmer-overlay-wrapper">
        <div class="shimmer-overlay"></div>
      </div>
    {/if}
  </div>

  <!-- Image attachments - shown below editor in Slack-style thumbnail row -->
  {#if imageAttachments.length > 0}
    <div
      class="flex min-w-0 items-center gap-2 overflow-x-auto py-1 scrollbar-none {contentInsetClasses}"
      style="-ms-overflow-style: none; scrollbar-width: none;"
    >
      {#each imageAttachments as item (item.id)}
        <AttachmentPreview
          id={item.id}
          name={item.label}
          type={item.file?.type || item.imageMimeType || ''}
          size={item.file?.size}
          file={item.file}
          imageData={item.imageData}
          imageMimeType={item.imageMimeType}
          onRemove={removeContextItem}
          variant="thumbnail"
        />
      {/each}
    </div>
  {/if}

  <!-- Hidden file input - accepts any file type -->
  <input bind:this={fileInput} type="file" multiple class="hidden" onchange={handleFileChange} />
  <!-- Action Bar -->
  <div
    class="action-bar flex items-center justify-between pb-1.5 {actionBarEndClassName} pt-0 text-muted-foreground transition-opacity duration-150 {edgeDocked
      ? 'flex-wrap gap-y-1'
      : ''} {contentInsetClasses}"
    data-chat-input-action-bar
  >
    <div class="flex items-center gap-2 min-w-0" data-chat-input-primary-actions>
      <ModelPicker
        bind:this={modelPickerRef}
        {selectedModel}
        variant="ghost-light"
        size="xs"
        triggerClass="px-0 font-medium text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-4"
        isLocked={isModelLocked}
        confirmModelChange={confirmModelSwitch}
        deferUpdate={isStreaming}
        workspaceId={workspace?.id}
        {agentId}
        portal
        updateGlobalStore
        showReasoning
        reasoningDisabled={disabled}
        onModelChange={(newModel, pick) => {
          if (!newModel) return;

          // Check if the model is from a different provider. The picker
          // resolves the pick's owning provider (catalog rows are bare for
          // every provider); parsing the id is only a legacy fallback.
          const rawProvider = pick?.providerId ?? parseCompoundModelId(newModel).providerId;
          const newProvider = normalizeProviderId(rawProvider);
          if (agentId && newProvider !== selectedProviderId) {
            // Provider is changing — run the full provider switch flow
            void handleProviderChangeFromModel(newProvider, newModel);
          } else {
            // Same provider — just update the model
            userChangedModel = true;
            lastNotifiedModel = newModel;
            selectedModel = newModel;
            onmodelChange?.(newModel);
          }
        }}
      />

      <!-- Context picker stays mounted for its popover API; its trigger lives in the action menu. -->
      <ContextPickerButton
        bind:this={contextPickerRef}
        panels={availablePanels}
        selections={availableSelections}
        {workspace}
        {disabled}
        currentAgentId={agentId}
        onToggle={handleTogglePanel}
        onToggleSelection={handleToggleSelection}
        onInsertMention={(mention) => tiptap?.insertMention(mention)}
        renderTrigger={false}
      />
    </div>

    <div
      class="flex items-center gap-1 min-w-0 {edgeDocked ? 'flex-wrap justify-end' : 'shrink-0'}"
      data-chat-input-submit-actions
    >
      <div class="relative inline-block">
        <Menu.Root>
          <Menu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost-light"
                size="icon-sm"
                {disabled}
                aria-label={m.ui_breadcrumb_more_label()}
                data-testid="prompt-actions-trigger"
              >
                <Fa icon={faPlus} size={16} class="size-4" />
              </Button>
            {/snippet}
          </Menu.Trigger>
          <Menu.StackedContent groups={promptActionGroups} align="end" side="top" class="w-52" />
        </Menu.Root>
      </div>

      {#if micTranscribing}
        <TooltipShortcut label={m.chat_richInput_micCancelTranscribing_label()} side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={handleMicCancelTranscription}
            onmousedown={handleMicMouseDown}
            aria-label={m.chat_richInput_micCancelTranscribing_label()}
            data-testid="composer-mic-button"
          >
            <Fa icon={faSpinner} size="sm" class="animate-spin" />
          </Button>
        </TooltipShortcut>
      {:else if micRecording}
        <TooltipShortcut label={m.chat_richInput_micStop_label()} shortcut="Escape" side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={handleMicClick}
            onmousedown={handleMicMouseDown}
            aria-label={m.chat_richInput_micStop_label()}
            aria-pressed="true"
            class="text-error-foreground animate-pulse"
            data-testid="composer-mic-button"
          >
            <Fa icon={faMicrophone} size="sm" />
          </Button>
        </TooltipShortcut>
      {:else if $effectiveVoiceEngine$ !== 'unavailable'}
        <TooltipShortcut label={m.chat_richInput_micStart_label()} side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            {disabled}
            onclick={handleMicClick}
            onmousedown={handleMicMouseDown}
            aria-label={m.chat_richInput_micStart_label()}
            aria-pressed="false"
            data-testid="composer-mic-button"
          >
            <Fa icon={faMicrophone} size="sm" />
          </Button>
        </TooltipShortcut>
      {/if}

      {#if showStopButton}
        <!-- Stop button — visible whenever the agent is responding/running,
             mirroring the Thinking indicator so users can interrupt across
             the pre-first-chunk, streaming, and waiting-on-subagents windows. -->
        <TooltipShortcut label={m.chat_richInput_stop_label()} side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={() => onstop?.()}
            aria-label={m.chat_richInput_stopStreaming_ariaLabel()}
            class="text-muted-foreground"
          >
            <Fa icon={faStop} size="sm" />
          </Button>
        </TooltipShortcut>

        {#if canSend}
          <div class="flex items-center gap-1" transition:slide={{ axis: 'x', duration: 200 }}>
            <TooltipShortcut
              label={m.chat_richInput_queueMessage_ariaLabel()}
              shortcut="Enter"
              side="top"
            >
              <Button
                variant="ghost-light"
                size="icon-sm"
                onclick={handleSubmit}
                disabled={isEnhancing}
                aria-label={m.chat_richInput_queueMessage_ariaLabel()}
              >
                <Fa icon={faClock} size="sm" />
              </Button>
            </TooltipShortcut>
            <TooltipShortcut
              label={m.chat_richInput_interruptAndSend_ariaLabel()}
              shortcut="cmd+Enter"
              side="top"
            >
              <Button
                variant="ghost-light"
                size="icon-sm"
                onclick={handleForceSubmit}
                disabled={isEnhancing}
                aria-label={m.chat_richInput_interruptAndSend_ariaLabel()}
                data-testid="interrupt-btn"
              >
                <Fa icon={faArrowRight} size="sm" />
              </Button>
            </TooltipShortcut>
          </div>
        {/if}
      {:else if editMode}
        <!-- Edit mode: Cancel and Save buttons -->
        <div class="flex items-center gap-1">
          <div class="absolute top-0.5 right-0.5">
            <TooltipShortcut label={m.chat_richInput_cancel_label()} shortcut="Escape" side="top">
              <Button variant="ghost-light" size="xs" onclick={() => oncancel?.()}>
                <Fa icon={faXmark} size="sm" />
              </Button>
            </TooltipShortcut>
          </div>
          <TooltipShortcut
            label={m.chat_richInput_saveAndResend_label()}
            shortcut="cmd+Enter"
            side="top"
          >
            <Button
              variant="ghost-light"
              size="icon-sm"
              aria-label={m.chat_richInput_saveAndResend_label()}
              onclick={handleSubmit}
              disabled={disabled || inputLocked || !canSend || isEnhancing}
            >
              <Fa icon={faArrowRight} size="sm" />
            </Button>
          </TooltipShortcut>
        </div>
      {:else}
        <TooltipShortcut label={m.chat_richInput_send_label()} shortcut="Enter" side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={handleSubmit}
            disabled={disabled || inputLocked || !canSend || isEnhancing}
            aria-label={m.chat_richInput_sendMessage_ariaLabel()}
          >
            <Fa icon={faArrowRight} size="sm" />
          </Button>
        </TooltipShortcut>
      {/if}
    </div>
  </div>
</div>

<!-- Mid-conversation model/provider switch confirmation -->
<ModelSwitchConfirmDialog
  open={modelSwitchDialog !== null}
  isProviderChange={modelSwitchDialog?.isProviderChange ?? false}
  fromModelLabel={modelSwitchDialog?.fromModelLabel ?? ''}
  toModelLabel={modelSwitchDialog?.toModelLabel ?? ''}
  fromProviderName={modelSwitchDialog?.fromProviderName ?? ''}
  toProviderName={modelSwitchDialog?.toProviderName ?? ''}
  onConfirm={() => settleModelSwitchDialog(true)}
  onCancel={() => settleModelSwitchDialog(false)}
/>

<style>
  .rich-input-container {
    position: relative;
  }

  .editor-wrapper :global(.tiptap-editor p.is-editor-empty:first-child::before),
  .editor-wrapper :global(.tiptap-editor p.is-empty:first-child::before) {
    transition: opacity 300ms ease-in-out;
  }

  .editor-wrapper.placeholder-hidden :global(.tiptap-editor p.is-editor-empty:first-child::before),
  .editor-wrapper.placeholder-hidden :global(.tiptap-editor p.is-empty:first-child::before) {
    opacity: 0;
  }

  /* Shimmer overlay for enhancement loading state */
  .shimmer-overlay-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .shimmer-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-card) 80%, transparent),
      transparent
    );
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .editor-wrapper :global(.tiptap-editor p.is-editor-empty:first-child::before),
    .editor-wrapper :global(.tiptap-editor p.is-empty:first-child::before) {
      transition: none;
    }

    .shimmer-overlay {
      animation: none;
      opacity: 0.5;
      transform: none;
    }
  }
</style>
