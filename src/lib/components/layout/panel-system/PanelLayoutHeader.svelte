<script lang="ts" module>
  /** Layout preset type */
  export type LayoutPresetId = 'single' | 'split-horizontal' | 'split-vertical' | 'three-column';

  /** Content-specific preset type */
  export type ContentPresetId =
    | 'focus-agent'
    | 'focus-code'
    | 'focus-notes'
    | 'code-review'
    | 'research';

  /** Tab configuration for AI-generated layouts */
  export interface TabConfig {
    type: 'agent' | 'note' | 'file' | 'terminal' | 'browser' | 'changes' | 'activity' | 'diff';
    // For referencing existing items
    agentId?: string;
    agentName?: string; // AI can reference by name
    noteId?: string;
    noteTitle?: string; // AI can reference by title
    filePath?: string;
    browserUrl?: string;
    // For creating new items
    createNew?: boolean;
    newAgentName?: string;
    title?: string; // Display title for the tab
  }

  /** Panel configuration for AI-generated layouts */
  export interface PanelConfig {
    tabs: TabConfig[];
    activeTabIndex?: number; // Which tab should be active (0-indexed)
  }

  /** Full layout command from AI */
  export interface LayoutCommand {
    type: 'single' | 'split-horizontal' | 'split-vertical' | 'three-column' | 'grid-2x2';
    panels: PanelConfig[];
    sizes?: number[]; // Percentages for panel sizes (should sum to 100)
  }
</script>

<script lang="ts">
  /**
   * PanelLayoutHeader - Top bar with navigation, layout controls, and AI layout prompt
   *
   * Shows:
   * - Back/Forward navigation buttons for content history
   * - Layout preset dropdown with contextual presets
   * - AI prompt input for layout reconfiguration
   */

  import {
  faArrowLeft,
  faArrowRight,
  faRobot,
  faCode,
  faFileAlt,
  faColumns,
  faTableColumns,
  faGripLines,
  faWandMagicSparkles,
  faChevronDown,
  faSpinner,
  faMagic,
  faGlobe,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    generateLayout,
    EnhancePromptUnavailableError,
    isEnhancePromptAvailable,
  } from '$lib/client/live/live-prompt-enhancement';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectModelForType } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import {
  fade,
  slide,
} from 'svelte/transition';
  import { toast } from 'svelte-sonner';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectForegroundWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';

  import { getShortcutDisplay } from '$lib/utils/shortcuts';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('PanelLayoutHeader');
  const fastModel$ = selectModelForType('fast');
  const effectiveProviderId$ = selectEffectiveDefaultProviderId();

  interface Props {
    /** Whether back navigation is available */
    canGoBack: boolean;
    /** Whether forward navigation is available */
    canGoForward: boolean;
    /** Current layout preset (for highlighting active) */
    currentPreset?: LayoutPresetId;
    /** Workspace ID for AI layout suggestions */
    workspaceId?: string;
    /** Callbacks */
    onGoBack: () => void;
    onGoForward: () => void;
    onApplyPreset: (preset: LayoutPresetId) => void;
    /** Apply a content-focused preset with specific tabs */
    onApplyContentPreset?: (preset: ContentPresetId) => void;
  }

  let {
    canGoBack,
    canGoForward,
    currentPreset,
    workspaceId,
    onGoBack,
    onGoForward,
    onApplyPreset,
    onApplyContentPreset,
  }: Props = $props();

  // §5.31 gate — AI layout generation is auggie-only; unset active provider defaults to auggie
  const aiLayoutAvailable = $derived(isEnhancePromptAvailable($effectiveProviderId$));

  // AI prompt state
  let promptValue = $state('');
  let isGenerating = $state(false);
  let showPrompt = $state(false);
  let promptInputRef = $state<HTMLInputElement | null>(null);

  // Preset dropdown state
  let showPresetDropdown = $state(false);

  // Layout presets (structure only)
  const layoutPresets = [
    {
      id: 'single' as const,
      label: () => m.layout_layoutHeader_singleShort_label(),
      icon: faGripLines,
      shortcut: '⌘1',
      description: () => m.layout_layoutHeader_single_description(),
    },
    {
      id: 'split-horizontal' as const,
      label: () => m.layout_presets_sideBySide_label(),
      icon: faColumns,
      shortcut: '⌘2',
      description: () => m.layout_layoutHeader_sideBySide_description(),
    },
    {
      id: 'split-vertical' as const,
      label: () => m.layout_presets_stacked_label(),
      icon: faTableColumns,
      shortcut: '⌘3',
      description: () => m.layout_layoutHeader_stacked_description(),
    },
    {
      id: 'three-column' as const,
      label: () => m.layout_presets_threeColumns_label(),
      icon: faColumns,
      shortcut: '⌘4',
      description: () => m.layout_layoutHeader_threeColumns_description(),
    },
  ];

  // Content-focused presets (structure + specific content)
  const contentPresets = [
    {
      id: 'focus-agent' as const,
      label: () => m.layout_layoutHeader_focusAgent_label(),
      icon: faRobot,
      description: () => m.layout_layoutHeader_focusAgent_description(),
    },
    {
      id: 'focus-code' as const,
      label: () => m.layout_layoutHeader_focusCode_label(),
      icon: faCode,
      description: () => m.layout_layoutHeader_focusCode_description(),
    },
    {
      id: 'focus-notes' as const,
      label: () => m.layout_layoutHeader_focusNotes_label(),
      icon: faFileAlt,
      description: () => m.layout_layoutHeader_focusNotes_description(),
    },
    {
      id: 'code-review' as const,
      label: () => m.layout_layoutHeader_codeReview_label(),
      icon: faColumns,
      description: () => m.layout_layoutHeader_codeReview_description(),
    },
    {
      id: 'research' as const,
      label: () => m.layout_layoutHeader_research_label(),
      icon: faGlobe,
      description: () => m.layout_layoutHeader_research_description(),
    },
  ];

  // Toggle prompt visibility
  function togglePrompt() {
    showPrompt = !showPrompt;
    if (showPrompt) {
      // Focus input after render
      setTimeout(() => promptInputRef?.focus(), 50);
    }
  }

  // Handle AI layout suggestion
  async function handleGenerateLayout() {
    if (!aiLayoutAvailable) return;
    if (!promptValue.trim() || isGenerating) return;

    isGenerating = true;
    const prompt = promptValue.trim();

    try {
      logger.info('Requesting AI layout suggestion', { prompt, workspaceId });

      // Build the layout suggestion prompt
      const layoutPrompt = buildLayoutPrompt(prompt);

      // Daemon-side one-shot generation (agent.enhancePrompt mode "layout", PROTOCOL §5.31)
      const result = await generateLayout(layoutPrompt, {
        workspaceId,
        model: $fastModel$,
      });

      logger.info('AI response received', { response: result.enhanced.substring(0, 500) });

      // Parse the layout from the response
      const layout = parseLayoutResponse(result.enhanced);
      if (layout) {
        logger.info('Parsed layout', { layout });
        applyParsedLayout(layout);
        promptValue = '';
        showPrompt = false;
        toast.success(m.layout_layoutControls_updated_label());
      } else {
        toast.error(m.layout_layoutControls_parseFailed_error());
        logger.warn('Failed to parse layout response', { response: result.enhanced });
      }
    } catch (error) {
      logger.error('Layout generation failed', error);
      toast.error(
        error instanceof EnhancePromptUnavailableError
          ? m.layout_layoutControls_generationUnavailable_error()
          : error instanceof Error && error.message
            ? m.layout_layoutControls_generationFailedWithMessage_error({ message: error.message })
            : m.layout_layoutControls_generationFailed_error(),
      );
    } finally {
      isGenerating = false;
    }
  }

  // Get workspace context for AI prompt
  function getWorkspaceContext(): {
    agents: Array<{ id: string; name: string; status: string }>;
    notes: Array<{ id: string; title: string }>;
  } {
    const state = appStore.state;
    // Get agents from the Redux store
    const agents = selectForegroundWorkspaceAgents.select(state, workspaceId ?? '');

    // Get notes from the notes store
    const notes = selectAllNotes.select(state, workspaceId ?? '');

    return { agents, notes };
  }

  // Build the prompt for layout suggestions
  function buildLayoutPrompt(userRequest: string): string {
    const context = getWorkspaceContext();

    const agentsContext =
      context.agents.length > 0
        ? `\nExisting agents in this workspace:
${context.agents.map((a) => `- "${a.name || a.id}" (id: ${a.id}, status: ${a.status})`).join('\n')}`
        : '\nNo agents exist yet in this workspace.'; // i18n-ignore (agent-facing prompt, kept in English)

    const notesContext =
      context.notes.length > 0
        ? `\nExisting notes in this workspace:
${context.notes.map((n) => `- "${n.title}" (id: ${n.id})`).join('\n')}`
        : '\nNo notes exist yet.'; // i18n-ignore (agent-facing prompt, kept in English)

    // i18n-ignore (agent-facing prompt, kept in English)
    return `You are a layout configuration assistant for a panel-based workspace app.

The user wants to reconfigure their panel layout. Based on their request, suggest a layout configuration.
${agentsContext}
${notesContext}

Available layout types:
- "single": One full-width panel
- "split-horizontal": Two panels side by side (left/right)
- "split-vertical": Two panels stacked (top/bottom)
- "three-column": Three panels in a row

Panel content types and their properties:
- "agent": AI chat panel
  - agentId: reference existing agent by ID
  - agentName: reference existing agent by name (I will find the ID)
  - createNew: true to create a new agent
  - newAgentName: name for the new agent
- "note": Markdown note editor
  - noteId: reference existing note by ID (e.g., "spec" for the main spec)
  - noteTitle: reference existing note by title
- "file": Code file viewer (specify filePath)
- "browser": Web browser (specify browserUrl)
- "terminal": Terminal panel
- "changes": Git changes view
- "activity": Activity log

IMPORTANT: Each panel can have MULTIPLE TABS. Use the "tabs" array to add multiple content items per panel.

User request: "${userRequest}"

Respond with a layout configuration in this exact format:
<layout>
{
  "type": "split-horizontal",
  "panels": [
    {
      "tabs": [
        { "type": "agent", "agentName": "Code Review" },
        { "type": "agent", "createNew": true, "newAgentName": "Testing" }
      ],
      "activeTabIndex": 0
    },
    {
      "tabs": [
        { "type": "note", "noteId": "spec" },
        { "type": "terminal" }
      ]
    }
  ],
  "sizes": [60, 40]
}
</layout>

Examples:
- "agents in a row" → three-column with one agent tab in each panel
- "put dark-mode agent next to spec" → split-horizontal, reference by name/id
- "3 new agents for frontend, backend, testing" → three-column, each with createNew: true
- "all agents on left, notes on right" → split-horizontal, multiple tabs per panel

Only respond with the <layout> tag and valid JSON inside it.`;
  }

  // Parse layout from AI response
  function parseLayoutResponse(response: string): LayoutCommand | null {
    try {
      // Extract content between <layout> tags
      const match = response.match(/<layout>\s*([\s\S]*?)\s*<\/layout>/i);
      if (!match?.[1]) {
        logger.warn('No <layout> tag found in response');
        return null;
      }

      const json = match[1].trim();
      const parsed = JSON.parse(json);

      // Validate the parsed layout
      if (!parsed.type || !Array.isArray(parsed.panels)) {
        logger.warn('Invalid layout structure', { parsed });
        return null;
      }

      // Normalize old format (content field) to new format (tabs array)
      for (const panel of parsed.panels) {
        if (!panel.tabs && panel.content) {
          // Convert old format to new format
          panel.tabs = [{ type: panel.content, ...panel }];
          delete panel.content;
        }
      }

      return parsed as LayoutCommand;
    } catch (error) {
      logger.error('Failed to parse layout JSON', error);
      return null;
    }
  }

  // Resolve agent/note references by name to IDs
  function resolveReferences(layout: LayoutCommand): LayoutCommand {
    const context = getWorkspaceContext();

    for (const panel of layout.panels) {
      for (const tab of panel.tabs) {
        // Resolve agent by name
        if (tab.type === 'agent' && tab.agentName && !tab.agentId) {
          const found = context.agents.find(
            (a) => (a.name || a.id).toLowerCase() === tab.agentName!.toLowerCase(),
          );
          if (found) {
            tab.agentId = found.id;
          }
        }

        // Resolve note by title
        if (tab.type === 'note' && tab.noteTitle && !tab.noteId) {
          const found = context.notes.find(
            (n) => n.title.toLowerCase() === tab.noteTitle!.toLowerCase(),
          );
          if (found) {
            tab.noteId = found.id;
          }
        }
      }
    }

    return layout;
  }

  // Apply the parsed layout
  function applyParsedLayout(layout: LayoutCommand) {
    // Resolve any name-based references to IDs
    const resolvedLayout = resolveReferences(layout);

    // First apply the structural preset
    onApplyPreset(resolvedLayout.type as LayoutPresetId);

    logger.info('Applied layout', { layout: resolvedLayout });

    // Dispatch an event with the full layout configuration for the parent to handle
    const event = new CustomEvent('layout:configure-panels', {
      detail: {
        panels: resolvedLayout.panels,
        sizes: resolvedLayout.sizes,
        workspaceId,
      },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  // Handle keyboard shortcuts in prompt
  function handlePromptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerateLayout();
    } else if (e.key === 'Escape') {
      showPrompt = false;
      promptValue = '';
    }
  }

  // Apply content preset
  function handleContentPreset(presetId: ContentPresetId) {
    showPresetDropdown = false;
    if (onApplyContentPreset) {
      onApplyContentPreset(presetId);
    } else {
      // Default behavior: apply structural preset based on content preset
      switch (presetId) {
        case 'focus-agent':
          onApplyPreset('single');
          break;
        case 'focus-code':
        case 'focus-notes':
          onApplyPreset('split-horizontal');
          break;
        case 'code-review':
        case 'research':
          onApplyPreset('three-column');
          break;
      }
    }
  }

  // Close dropdown when clicking outside
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.preset-dropdown-container')) {
      showPresetDropdown = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="panel-layout-header flex items-center justify-center gap-1 h-8 px-2 shrink-0">
  <!-- Navigation buttons -->
  <div class="flex items-center gap-0.5 ml-auto">
    <Tooltip
      content={m.layout_layoutHeader_goBack_tooltip({ shortcut: getShortcutDisplay('GO_BACK') })}
      side="bottom"
      delayDuration={300}
    >
      <button
        class={cn(
          'p-1.5 rounded hover:bg-muted transition-colors',
          canGoBack ? 'text-foreground' : 'text-ghost cursor-not-allowed',
        )}
        onclick={onGoBack}
        disabled={!canGoBack}
        aria-label={m.layout_layoutHeader_goBack_ariaLabel()}
      >
        <Fa icon={faArrowLeft} size="sm" />
      </button>
    </Tooltip>
    <Tooltip
      content={m.layout_layoutHeader_goForward_tooltip({ shortcut: getShortcutDisplay('GO_FORWARD') })}
      side="bottom"
      delayDuration={300}
    >
      <button
        class={cn(
          'p-1.5 rounded hover:bg-muted transition-colors',
          canGoForward ? 'text-foreground' : 'text-ghost cursor-not-allowed',
        )}
        onclick={onGoForward}
        disabled={!canGoForward}
        aria-label={m.layout_layoutHeader_goForward_ariaLabel()}
      >
        <Fa icon={faArrowRight} size="sm" />
      </button>
    </Tooltip>
  </div>

  <!-- Separator -->
  <div class="w-px h-4 bg-border mx-1"></div>

  <!-- Layout presets with dropdown -->
  <div class="preset-dropdown-container relative flex items-center gap-0.5">
    <!-- Quick layout buttons -->
    {#each layoutPresets as preset (preset.id)}
      <Tooltip content={m.layout_layoutHeader_presetWithShortcut_tooltip({ label: preset.label(), shortcut: preset.shortcut })} side="bottom" delayDuration={300}>
        <button
          class={cn(
            'p-1.5 rounded transition-colors',
            currentPreset === preset.id
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
          onclick={() => onApplyPreset(preset.id)}
          aria-label={preset.label()}
        >
          <Fa
            icon={preset.icon}
            size="sm"
            class={preset.id === 'split-vertical' ? 'rotate-90' : ''}
          />
        </button>
      </Tooltip>
    {/each}

    <!-- Content presets dropdown trigger -->
    <Tooltip content={m.layout_layoutHeader_layoutPresets_tooltip()} side="bottom" delayDuration={300}>
      <button
        class={cn(
          'p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted',
          showPresetDropdown && 'bg-muted text-foreground',
        )}
        onclick={() => (showPresetDropdown = !showPresetDropdown)}
        aria-label={m.layout_layoutHeader_morePresets_ariaLabel()}
      >
        <Fa icon={faChevronDown} size="xs" />
      </button>
    </Tooltip>

    <!-- Preset dropdown menu -->
    {#if showPresetDropdown}
      <div
        class="absolute bottom-full left-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1"
        transition:fade={{ duration: 100 }}
      >
        <div class="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {m.layout_layoutHeader_focusModes_header()}
        </div>
        {#each contentPresets as preset (preset.id)}
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
            onclick={() => handleContentPreset(preset.id)}
          >
            <Fa icon={preset.icon} class="w-4 h-4 text-ghost" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{preset.label()}</div>
              <div class="text-xs text-subtle truncate">{preset.description()}</div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- AI Layout prompt toggle (§5.31 auggie-only gate) -->
  {#if aiLayoutAvailable}
    <Tooltip content={m.layout_layoutHeader_aiSuggestion_tooltip()} side="bottom" delayDuration={300}>
      <button
        class={cn(
          'p-1.5 rounded transition-colors',
          showPrompt
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        )}
        onclick={togglePrompt}
        aria-label={m.layout_layoutHeader_configureWithAi_ariaLabel()}
      >
        <Fa icon={faWandMagicSparkles} size="sm" />
      </button>
    </Tooltip>
  {/if}

  <!-- AI Prompt input (expanded) -->
  {#if aiLayoutAvailable && showPrompt}
    <div class="flex items-center gap-1 ml-1" transition:slide={{ duration: 150, axis: 'x' }}>
      <input
        bind:this={promptInputRef}
        bind:value={promptValue}
        onkeydown={handlePromptKeydown}
        type="text"
        placeholder={m.layout_layoutHeader_describeIdealLayout_placeholder()}
        disabled={isGenerating}
        class={cn(
          'w-48 h-6 px-2 text-xs rounded border border-border bg-background',
          'placeholder:text-muted-foreground/50',
          'focus:outline-none focus:ring-1 focus:ring-primary/50',
          'disabled:opacity-50',
        )}
      />
      <button
        class={cn(
          'p-1 rounded transition-colors',
          promptValue.trim() && !isGenerating
            ? 'text-primary hover:bg-primary/10'
            : 'text-ghost cursor-not-allowed',
        )}
        onclick={handleGenerateLayout}
        disabled={!promptValue.trim() || isGenerating}
        aria-label={m.layout_layoutHeader_generate_ariaLabel()}
      >
        {#if isGenerating}
          <Fa icon={faSpinner} size="sm" class="animate-spin" />
        {:else}
          <Fa icon={faMagic} size="sm" />
        {/if}
      </button>
    </div>
  {/if}
</div>
