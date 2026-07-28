<script lang="ts">
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
/* eslint-disable max-lines */
  import {
  onMount,
  tick,
} from 'svelte';
  import { toast } from 'svelte-sonner';
  import { createLogger } from '$lib/utils/client-logger';
  import type { Workspace } from '$shared/types';
  import {
  getDefaultProviderId,
  getProviderConfig,
  parseCompoundModelId,
} from '$shared/config/provider-config';
  import { enhancePrompt } from '$lib/client/live/live-prompt-enhancement';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import TooltipRich from '$lib/components/ui/tooltip/TooltipRich.svelte';

  import { updateSession as updateAgentSessionFields } from '$store/renderer/slices/agent-session/agent-session-slice';

  import { agentClient } from '$features/agent/agent.client';

  import { getAgentProvider } from '$shared/types/agent-session';
  import Fa from 'svelte-fa';
  import {
  faMagicWandSparkles,
  faPaperclip,
  faPaperPlane,
  faXmark,
  faLayerGroup,
  faStop,
} from '@fortawesome/free-solid-svg-icons';
  import Button from '../../ui/button/button.svelte';
  import TipTapEditor from './TipTapEditor.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import ModelSwitchConfirmDialog from '../ModelSwitchConfirmDialog.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import AttachmentPreview from '../AttachmentPreview.svelte';
  import ContextChip from '../ContextChip.svelte';
  import ContextPickerButton from './ContextPickerButton.svelte';


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
    /** Padding/spacing class applied to the rich text editor content. */
    editorClassName?: string;
    onsubmit?: (value: string) => void;
    onforcesubmit?: (value: string) => void; // Interrupt streaming and send immediately
    onenhance?: () => void | Promise<void>;
    onstop?: () => void;
    /** Cancel callback for edit mode */
    oncancel?: () => void;
    oncontextAdd?: (item: ContextItem) => void;
    oncontextRemove?: (id: string) => void;
    onmodelChange?: (modelId: string) => void;
    /** Callback to get previous history item (up arrow) - returns null if at start of history */
    onHistoryPrev?: () => string | null;
    /** Callback to get next history item (down arrow) - returns null if at end of history */
    onHistoryNext?: () => string | null;
  }

  // Import ContextItem from context-api.ts
  import type { ContextItem } from './context-api';
  import { cn } from '$lib/utils';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  export type { ContextItem };

  let {
    value = $bindable(''),
    placeholder = m.chat_richInput_askAnything_placeholder(),
    disabled = false,
    editableWhileDisabled = false,
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

    panelFocused: _panelFocused = true, // Reserved for future use

    compactMode: _compactMode = false, // Reserved for future use
    editorClassName = 'px-2!',
    onsubmit,
    onforcesubmit,
    onenhance,
    onstop,
    oncancel,
    oncontextAdd,
    oncontextRemove,
    onmodelChange,
    onHistoryPrev,
    onHistoryNext,
  }: Props = $props();

  // Track if enhancement is in progress
  let isEnhancing = $state(false);
  let enhanceRequestId = $state(0); // Increment for each request
  let cancelledRequestId = $state(-1); // Track which request was cancelled
  let tiptap: any = $state(null);
  let modelPickerRef: { open: () => void; clearFallbackWarning: () => void; clearPendingUpdate: () => void } | null =
    $state(null);
  let previousDisabled = $state(disabled);
  let hasInlineImages = $state(false);

  // Derived state: whether there's content to send (text, context items, or inline images)
  let canSend = $derived(value.trim() || contextItems.length > 0 || hasInlineImages);

  // Separate image attachments from other context items for Slack-style layout
  // An item is an image attachment only if we can actually render a thumbnail:
  // - Has both imageData AND imageMimeType (base64 data URL), OR
  // - Has a File object with an image/* mime type
  const imageAttachments = $derived(
    contextItems.filter(
      (item) =>
        item.type === 'file' &&
        ((item.imageData && item.imageMimeType) || (item.file && item.file.type?.startsWith('image/')))
    )
  );
  const nonImageItems = $derived(
    contextItems.filter(
      (item) =>
        !(
          item.type === 'file' &&
          ((item.imageData && item.imageMimeType) || (item.file && item.file.type?.startsWith('image/')))
        )
    )
  );

  // The Stop affordance mirrors the Thinking indicator: visible for the entire
  // turn the agent is responding, not just while text chunks are streaming.
  // The broader "coordinator waiting on delegated children" state (PROTOCOL §5.5
  // isWaitingForOtherAgents) is intentionally NOT a Stop condition — there is
  // no turn to stop while a parent is idle-waiting, and that affordance lives
  // on sidebar/list surfaces (IDLE-1).
  let showStopButton = $derived(isStreaming || isResponding);

  $effect(() => {
    const justEnabled = previousDisabled && !disabled;
    previousDisabled = disabled;

    if (justEnabled) {
      void tick().then(() => focus());
    }
  });

  // Export focus method for parent components
  export async function focus(): Promise<boolean> {
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
    value = '';
    contextItems = [];
  }

  // Export setContent method for parent components (e.g., suggested prompts)
  export async function setContent(text: string) {
    value = text;
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
        const base64Marker = ';base64,';
        const markerIndex = src.indexOf(base64Marker);
        if (markerIndex === -1) {
          logger.warn('SimpleRichInput: Failed to parse image data URL', {
            index,
            alt: img.alt,
            srcLength: src.length,
          });
          return null;
        }
        const mimeType = src.substring(5, markerIndex); // 5 = 'data:'.length
        const base64Data = src.substring(markerIndex + base64Marker.length);
        if (!mimeType || !base64Data) {
          logger.warn('SimpleRichInput: Empty mimeType or base64Data in image data URL', {
            index,
            alt: img.alt,
            mimeType,
            hasData: base64Data.length > 0,
          });
          return null;
        }
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
  let initialY = 0;
  let initialHeight = 0;

  // Track parent panel height for max height calculation
  let parentPanelHeight = $state<number | null>(null);
  let containerRef = $state<HTMLDivElement | null>(null);

  // Height constraints for auto-expand
  const MIN_HEIGHT = 65;
  const COMPACT_PANEL_THRESHOLD = 450; // Panel height below which we use compact input
  const MAX_HEIGHT_PERCENTAGE = 0.8; // Max 80% of parent panel
  const MAX_HEIGHT_ABSOLUTE = 800; // Absolute max in pixels
  const FALLBACK_MAX_HEIGHT = 300;

  // Use 65px for short panels, larger default for taller panels
  let dynamicDefaultHeight = $derived.by(() => {
    if (parentPanelHeight && parentPanelHeight > COMPACT_PANEL_THRESHOLD) {
      // Taller panel - use a larger default (but still reasonable)
      return 100;
    }
    // Short panel or unknown - use minimum
    return MIN_HEIGHT;
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
  let selectedModel = $state<string | null | undefined>(propSelectedModel);

  // Track the last notified model to prevent infinite loops
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
      return getProviderConfig(propProviderId).id;
    }

    if (!agentId) {
      return getProviderConfig(getDefaultProviderId()).id;
    }

    const session = workspace?.id
      ? selectAgentSession.select(appStore.state, agentId)
      : undefined;
    const provider = session ? getAgentProvider(session) : undefined;
    return provider ? getProviderConfig(provider).id : undefined;
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
      const provider = selectedProviderId || getDefaultProviderId();
      const config = getProviderConfig(provider);
      return {
        modelLabel: m.chat_richInput_defaultModel_label(),
        providerName: config.displayName,
        providerId: config.id,
      };
    }
    // Bare (non-compound) ids belong to the agent's current provider, not the
    // default provider parseCompoundModelId falls back to.
    const rawProvider = model.includes(':')
      ? parseCompoundModelId(model).providerId
      : selectedProviderId || getDefaultProviderId();
    const config = getProviderConfig(rawProvider);
    return {
      modelLabel: parseCompoundModelId(model).modelId,
      providerName: config.displayName,
      providerId: config.id,
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

    const previousSession = agentId && workspace?.id
      ? selectAgentSession.select(appStore.state, agentId)
      : undefined;
    const previousProvider = selectedProviderId;
    const previousModel = selectedModel;

    isChangingProvider = true;
    localProviderId = newProvider;
    userChangedModel = true;
    selectedModel = newModel;
    lastNotifiedModel = newModel;

    appStore.dispatch(updateAgentSessionFields(agentId, {
      provider: newProvider,
      model: newModel,
      metadata: {
        ...(previousSession?.metadata || {}),
        provider: newProvider,
      },
    }));

    try {
      const result = await agentClient.setModel(agentId, newModel, workspace.id);
      if (!result.ok || !result.data.success) {
        throw new Error(result.ok ? result.data.error : result.error);
      }
      onmodelChange?.(newModel);
    } catch (error) {
      logger.error('Failed to switch agent provider via model change', { error, agentId, newProvider });
      localProviderId = previousProvider === hydratedPropProviderId ? undefined : previousProvider;
      selectedModel = previousModel;
      lastNotifiedModel = previousModel;
      userChangedModel = false;
      const rollbackProvider = previousProvider ?? previousSession?.provider ?? previousSession?.metadata?.provider as string | undefined;
      const rollbackModel = previousModel ?? previousSession?.model;
      if (rollbackProvider && rollbackModel) {
        appStore.dispatch(updateAgentSessionFields(agentId, {
          provider: rollbackProvider,
          model: rollbackModel,
          metadata: {
            ...(previousSession?.metadata || {}),
            provider: rollbackProvider,
          },
        }));
      }
      toast.error(
        error instanceof Error
          ? error.message
          : m.chat_richInput_switchFailed_error({
              provider: getProviderConfig(newProvider).displayName,
            }),
      );
    } finally {
      modelPickerRef?.clearPendingUpdate();
      isChangingProvider = false;
    }
  }

  function removeContextItem(id: string) {
    contextItems = contextItems.filter((item) => item.id !== id);
    oncontextRemove?.(id);
  }

  function handleSubmit() {
    if (!canSend || disabled) {
      return;
    }
    // Clear any model fallback warning since user is sending a message with the new model
    modelPickerRef?.clearFallbackWarning();
    // Allow submission even if processing - the parent will handle stopping the current message
    onsubmit?.(value);
  }

  function handleForceSubmit() {
    if (!canSend || disabled) {
      return;
    }
    // Force submit interrupts streaming and sends immediately
    onforcesubmit?.(value);
  }

  async function handleEnhancePrompt() {
    if (!value.trim() || isEnhancing) return;

    isEnhancing = true;
    const currentRequestId = ++enhanceRequestId;

    try {
      // Call the enhance handler if provided
      if (onenhance) {
        await onenhance();
      } else {
        // No handler provided: enhance through the daemon (agent.enhancePrompt, PROTOCOL §5.31)
        const result = await enhancePrompt(value, { model: selectedModel ?? undefined });

        // Check if THIS request was cancelled before applying result
        if (currentRequestId === cancelledRequestId) {
          return;
        }

        value = result.enhanced;
        toast.success(m.chat_richInput_promptEnhanced_toast());
      }
    } catch (error) {
      // Don't show error if it was cancelled
      if (currentRequestId === cancelledRequestId) {
        return;
      }
      logger.error('Failed to enhance prompt:', error);
      toast.error(
        error instanceof Error && error.message
          ? m.chat_richInput_enhanceFailedDetail_error({ detail: error.message })
          : m.chat_richInput_enhanceFailed_error(),
      );
    } finally {
      // Only reset isEnhancing if this request wasn't cancelled
      // (cancelled requests already set isEnhancing = false)
      if (currentRequestId !== cancelledRequestId) {
        isEnhancing = false;
      }
    }
  }

  function handleCancelEnhance() {
    if (isEnhancing) {
      cancelledRequestId = enhanceRequestId;
      isEnhancing = false;
    }
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

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
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

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    await processImageFiles(Array.from(files));
  }

  // Handle clipboard paste for images
  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images
      await processImageFiles(imageFiles);
    }
  }

  /**
   * Convert a File to a base64 data URL
   */
  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Process image files by inserting them inline in the editor
   */
  async function processImageFiles(files: File[]) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const addedCount = { value: 0 };
    const oversizedFiles: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(file.name);
        continue;
      }

      // Non-image files go to context items via the non-image path
      if (!file.type.startsWith('image/')) {
        await processNonImageFile(file);
        continue;
      }

      try {
        const dataUrl = await fileToDataUrl(file);
        // Extract base64 data from data URL (remove "data:image/...;base64," prefix)
        const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!base64Match) {
          throw new Error('Invalid data URL format');
        }
        const [, mimeType, base64Data] = base64Match;

        // Add image to context items (attachment flow) instead of inserting inline
        const timestamp = Date.now();
        const fileName = file.name || `image-${timestamp}.${mimeType.split('/')[1] || 'png'}`;
        const contextItem: ContextItem = {
          id: `file-upload-${timestamp}-${fileName}`,
          type: 'file',
          label: fileName,
          description: `${mimeType} • ${formatFileSize(file.size)}`,
          path: fileName,
          file: file,
          imageData: base64Data,
          imageMimeType: mimeType,
        };

        contextItems = [...contextItems, contextItem];
        oncontextAdd?.(contextItem);
        addedCount.value++;
      } catch (error) {
        logger.error('Failed to add image to context', { fileName: file.name, error });
        toast.error(m.chat_richInput_addImageFailed_error({ name: file.name }));
      }
    }

    if (addedCount.value > 0) {
      logger.debug(`Added ${addedCount.value} image(s) to context`);
      toast.success(
        addedCount.value === 1
          ? m.chat_richInput_addedImages_toast_one()
          : m.chat_richInput_addedImages_toast_many({ count: formatInteger(addedCount.value) }),
      );
    }

    if (oversizedFiles.length > 0) {
      toast.error(m.chat_richInput_filesTooLarge_error({ names: oversizedFiles.join(', ') }));
    }
  }

  /**
   * Process non-image files by adding them to context items
   */
  async function processNonImageFile(file: File) {
    const fileName =
      file.name === 'image.png' || file.name === 'image.jpg'
        ? `pasted-file-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
        : file.name;

    const contextItem: ContextItem = {
      id: `file-upload-${Date.now()}-${fileName}`,
      type: 'file',
      label: fileName,
      description: m.chat_richInput_fileTypeSize_description({
        type: file.type || m.chat_richInput_unknownType_fallback(),
        size: formatFileSize(file.size),
      }),
      path: fileName,
      file: file,
    };

    contextItems = [...contextItems, contextItem];
    oncontextAdd?.(contextItem);
    toast.success(m.chat_richInput_addedFile_toast({ name: fileName }));
  }


  // Set up ResizeObserver to track parent panel height
  $effect(() => {
    if (!containerRef) return;

    const parentPanel = containerRef.closest('.group\\/panel') as HTMLElement | null;
    if (!parentPanel) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        parentPanelHeight = entry.contentRect.height;
      }
    });
    resizeObserver.observe(parentPanel);
    // Get initial height
    parentPanelHeight = parentPanel.clientHeight;

    return () => {
      resizeObserver.disconnect();
    };
  });

  onMount(() => {
    // Note: Selection changes from editors (CodeEditor/Monaco) are synced to the
    // multi-panel-context Redux store via ChatPanel which watches editor:selection-change events.
  });

  // Listen for global enhance prompt shortcut (Cmd+/)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleEnhancePromptEvent = () => {
      handleEnhancePrompt();
    };

    window.addEventListener('chat:enhance-prompt', handleEnhancePromptEvent);

    return () => {
      window.removeEventListener('chat:enhance-prompt', handleEnhancePromptEvent);
    };
  });

  // Listen for global model picker shortcut (Cmd+Alt+.)
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenModelPicker = () => {
      modelPickerRef?.open();
    };

    window.addEventListener('chat:open-model-picker', handleOpenModelPicker);

    return () => {
      window.removeEventListener('chat:open-model-picker', handleOpenModelPicker);
    };
  });

  // Track last workspace ID to prevent unnecessary updates
  let lastWorkspaceId = $state<string | undefined>(undefined);

  // Update workspace when it changes
  $effect(() => {
    if (workspace?.id && workspace.id !== lastWorkspaceId) {
      lastWorkspaceId = workspace.id;
      // Workspace tracking now handled by Redux setActiveWorkspaceId
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
</script>

<div
  bind:this={containerRef}
  class={cn(
    'relative rich-input-container flex flex-col group-[.focused]/panel:bg-sidebar bg-sidebar rounded transition-colors',
    {
      'border-border': !isDragging,
      'border-primary border-dashed': isDragging,
    },
  )}
  style={isAutoExpand
    ? `min-height: ${dynamicDefaultHeight}px; max-height: ${maxAutoHeight}px;`
    : `height: ${containerHeight}px;`}
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
  ondragover={handleDragOver}
  ondrop={handleDrop}
  onpaste={handlePaste}
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
    class="resize-handle absolute left-1/2 -translate-x-1/2 w-12 h-1 cursor-ns-resize group z-10 bg-transparent border-0 p-0 opacity-0 pointer-events-none group-[.focused]/panel:opacity-100 group-[.focused]/panel:pointer-events-auto {editMode
      ? 'bottom-[-0.5px] translate-y-1/2'
      : 'top-[-0.5px] -translate-y-1/2'}"
    onmousedown={startResize}
    ondblclick={handleResizeDoubleClick}
    aria-label={m.chat_richInput_resize_ariaLabel()}
    tabindex="-1"
  >
    <div class="resize-handle-bar w-full h-full flex items-center justify-center">
      <div
        class="w-8 h-0.75 bg-border rounded-full group-hover:bg-muted-foreground transition-colors"
      ></div>
    </div>
  </button>

  <!-- Non-image context items and selections - shown above editor when present -->
  {#if nonImageItems.length > 0}
    <div
      class="flex items-center gap-1 px-1 py-0.5 min-w-0 overflow-x-auto scrollbar-none"
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
        {:else if item.type === 'file' && (item.file || item.imageData)}
          <!-- Non-image file with chip preview -->
          <AttachmentPreview
            id={item.id}
            name={item.label}
            type={item.file?.type || item.imageMimeType || ''}
            size={item.file?.size}
            file={item.file}
            imageData={item.imageData}
            imageMimeType={item.imageMimeType}
            onRemove={removeContextItem}
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
    class="editor-wrapper relative min-h-0 cursor-text {isAutoExpand
      ? 'flex-1 overflow-y-auto'
      : 'flex-1 overflow-hidden'} {editMode ? 'pr-5' : ''}"
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
        {disabled}
        {editableWhileDisabled}
        workspace={workspace ?? undefined}
        onUpdate={(text) => {
          value = text;
          // Update inline images state for send button reactivity
          hasInlineImages = (tiptap?.getInlineImages?.() ?? []).length > 0;
        }}
        onSubmit={handleSubmit}
        onForceSubmit={handleForceSubmit}
        onEscape={editMode ? oncancel : showStopButton ? onstop : undefined}
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
      class="flex items-center gap-2 px-1 py-1 min-w-0 overflow-x-auto scrollbar-none"
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
    class="action-bar flex items-end justify-between px-1 pt-0 pb-0.5 transition-opacity duration-150"
  >
    <div class="flex items-end gap-1 min-w-0 mb-0.5">
      <ModelPicker
        bind:this={modelPickerRef}
        {selectedModel}
        variant="ghost-light"
        size="xs"
        isLocked={isModelLocked}
        confirmModelChange={confirmModelSwitch}
        deferUpdate={isStreaming}
        workspaceId={workspace?.id}
        {agentId}
        portal
        updateGlobalStore
        onModelChange={(newModel) => {
          if (!newModel) return;

          // Check if the model is from a different provider
          const rawProvider = parseCompoundModelId(newModel).providerId;
          const newProvider = getProviderConfig(rawProvider).id;
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

      <!-- Context Picker Button (@ icon with popover) - includes panels and selections -->
      <ContextPickerButton
        panels={availablePanels}
        selections={availableSelections}
        {workspace}
        {disabled}
        currentAgentId={agentId}
        onToggle={handleTogglePanel}
        onToggleSelection={handleToggleSelection}
        onInsertMention={(mention) => tiptap?.insertMention(mention)}
      />
    </div>

    <div class="flex items-end gap-px min-w-0 shrink-0 -mb-0.5">
      <TooltipShortcut label={m.chat_richInput_attachFiles_label()} side="top">
        <Button
          variant="ghost-light"
          size="icon-sm"
          {disabled}
          onclick={handleFileSelect}
          aria-label={m.chat_richInput_attachFiles_label()}
        >
          <Fa icon={faPaperclip} size="sm" />
        </Button>
      </TooltipShortcut>

      {#if isEnhancing}
        <TooltipShortcut label={m.chat_richInput_stopEnhancing_label()} side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={handleCancelEnhance}
            aria-label={m.chat_richInput_stopEnhancing_label()}
            class="text-destructive-foreground"
          >
            <Fa icon={faStop} size="sm" />
          </Button>
        </TooltipShortcut>
      {:else}
        <TooltipShortcut label={m.chat_richInput_enhancePrompt_label()} shortcut="cmd+/" side="top">
          <Button
            variant="ghost-light"
            size="icon-sm"
            onclick={handleEnhancePrompt}
            disabled={disabled || !value.trim()}
            aria-label={m.chat_richInput_enhancePrompt_label()}
          >
            <Fa icon={faMagicWandSparkles} size="sm" />
          </Button>
        </TooltipShortcut>
      {/if}

      {#if showStopButton}
        <!-- Stop button — visible whenever the agent is responding/running,
             mirroring the Thinking indicator so users can interrupt across
             the pre-first-chunk, streaming, and waiting-on-subagents windows. -->
        <TooltipShortcut label={m.chat_richInput_stop_label()} shortcut="Escape" side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            onclick={() => onstop?.()}
            aria-label={m.chat_richInput_stopStreaming_ariaLabel()}
            class="text-destructive-foreground"
          >
            <Fa icon={faStop} size="sm" />
          </Button>
        </TooltipShortcut>

        {#if value.trim()}
          <!-- Split button when streaming with text: Queue | Interrupt -->
          <div
            class="flex items-stretch bg-sidebar border border-border rounded-md"
            transition:slide={{ axis: 'x', duration: 200 }}
          >
            <!-- Queue button -->
            <button
              class="relative flex-1 flex flex-col items-center justify-center gap-1 px-2 py-2.5 min-w-9 bg-transparent border-none cursor-pointer transition-colors text-primary not-disabled:hover:bg-background overflow-visible"
              onclick={handleSubmit}
              aria-label={m.chat_richInput_queueMessage_ariaLabel()}
            >
              <div class="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full">
                <span
                  class="text-[0.66rem] leading-none whitespace-nowrap text-subtle flex flex-col"
                  >{m.chat_richInput_queue_label()}</span
                >
                <div class="text-subtle text-[0.6rem]">↵</div>
              </div>

              <Fa icon={faLayerGroup} size="12" />
            </button>

            <!-- Divider -->
            <div class="w-px bg-border"></div>

            <!-- Interrupt button (stop + send immediately) -->
            <button
              class="relative flex-1 flex flex-col items-center justify-center gap-1 px-2 py-2.5 min-w-9 bg-transparent border-none cursor-pointer transition-colors text-destructive-foreground not-disabled:hover:bg-background"
              onclick={handleForceSubmit}
              aria-label={m.chat_richInput_interruptAndSend_ariaLabel()}
              data-testid="interrupt-btn"
            >
              <div class="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full">
                <span
                  class="text-[0.66rem] leading-none whitespace-nowrap text-subtle flex flex-col"
                  >{m.chat_richInput_send_label()}</span
                >
                <div class="text-subtle text-[0.6rem]">⌘↵</div>
              </div>
              <Fa icon={faPaperPlane} size="11" />
            </button>
          </div>
        {/if}
      {:else if editMode}
        <!-- Edit mode: Cancel and Save buttons -->
        <div class="flex items-center gap-1">
          <div class="absolute top-0.5 right-0.5">
            <TooltipShortcut label={m.chat_richInput_cancel_label()} shortcut="Escape" side="top">
              <Button
                variant="ghost"
                size="xs"
                onclick={() => oncancel?.()}
                class="text-subtle"
              >
                <Fa icon={faXmark} class="mr-1" size="sm" />
              </Button>
            </TooltipShortcut>
          </div>
          <TooltipShortcut
            label={m.chat_richInput_saveAndResend_label()}
            shortcut="cmd+Enter"
            side="top"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-primary disabled:text-subtle"
              onclick={handleSubmit}
              disabled={disabled || !canSend}
            >
              <Fa icon={faPaperPlane} class="mr-1" size="sm" />
            </Button>
          </TooltipShortcut>
        </div>
      {:else}
        <TooltipShortcut label={m.chat_richInput_send_label()} shortcut="Enter" side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-primary disabled:text-subtle"
            onclick={handleSubmit}
            disabled={disabled || !canSend}
            aria-label={m.chat_richInput_sendMessage_ariaLabel()}
          >
            <Fa icon={faPaperPlane} size="sm" />
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

  /* Shimmer overlay for enhancement loading state */
  .shimmer-overlay-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
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
      color-mix(in srgb, var(--color-background) 80%, transparent),
      transparent
    );
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
  }

  :global(.panel.focused) .shimmer-overlay {
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-sidebar) 80%, transparent),
      transparent
    );
    background-size: 200% 100%;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  :global(.panel:not(.focused) .rich-input-container) {
    background-color: color-mix(in srgb, var(--color-background) 60%, var(--color-sidebar) 40%);
  }

  /* Hide placeholder when panel is not focused */
  :global(.panel:not(.focused) .rich-input-container .is-editor-empty::before) {
    opacity: 0;
    transition: opacity 150ms;
  }
  :global(.panel.focused .rich-input-container .is-editor-empty::before) {
    opacity: 1;
    transition: opacity 150ms;
  }
</style>
