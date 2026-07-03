<script lang="ts" module>
  // Re-export types from types.ts for backwards compatibility
  export type { LayoutPreset, LayoutPresetId } from './types';
</script>

<script lang="ts">
  /**
   * PanelLayoutControls - Expandable layout controls for the panel system
   *
   * Features:
   * - Collapsed: Shows minimap of current panel layout
   * - Expanded (on hover via CSS): Shows back/forward nav, preset dropdown, AI prompt
   * - Absolutely positioned above the progress card in sidebar
   */

  import type { PanelLayoutNode } from '$features/layout/panel-layout-adapter';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { selectForegroundWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';

  import { generateLayout } from '$lib/client/live/live-prompt-enhancement';
  import { selectModelForType } from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import { toast } from 'svelte-sonner';
  import LayoutPresetDropdown from './LayoutPresetDropdown.svelte';
  import PanelMinimap from './PanelMinimap.svelte';
  import type { LayoutPresetId } from './types';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('PanelLayoutControls');
  const fastModel$ = selectModelForType('fast');

  interface Props {
    /** Current layout tree root node */
    layoutRoot: PanelLayoutNode | null;
    /** Whether back navigation is available */
    canGoBack: boolean;
    /** Whether forward navigation is available */
    canGoForward: boolean;
    /** Current preset ID if applicable */
    currentPreset?: LayoutPresetId;
    /** Workspace ID */
    workspaceId: string;
    /** Callbacks */
    onGoBack: () => void;
    onGoForward: () => void;
    onApplyPreset: (presetId: LayoutPresetId) => void;
  }

  let {
    layoutRoot,
    canGoBack,
    canGoForward,
    currentPreset,
    workspaceId,
    onGoBack,
    onGoForward,
    onApplyPreset,
  }: Props = $props();

  // Track if dropdown is open
  let promptValue = $state('');
  let isGenerating = $state(false);

  function handlePromptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerateLayout();
    }
  }

  async function handleGenerateLayout() {
    if (!promptValue.trim() || isGenerating) return;

    isGenerating = true;
    const prompt = promptValue.trim();

    try {
      logger.info('Requesting AI layout suggestion', { prompt, workspaceId });

      const layoutPrompt = buildLayoutPrompt(prompt);

      // Daemon-side one-shot generation (agent.enhancePrompt mode "layout", PROTOCOL §5.31)
      const result = await generateLayout(layoutPrompt, {
        workspaceId,
        model: $fastModel$,
      });

      logger.info('AI response received', { response: result.enhanced.substring(0, 500) });
      const layout = parseLayoutResponse(result.enhanced);
      if (layout) {
        logger.info('Parsed layout', { layout });
        applyParsedLayout(layout);
        promptValue = '';
        toast.success('Layout updated!');
      } else {
        logger.warn('Failed to parse layout response', { response: result.enhanced });
        toast.error('Could not parse layout suggestion');
      }
    } catch (error) {
      logger.error('Layout generation failed', error);
      toast.error(
        error instanceof Error && error.message
          ? `Layout generation failed: ${error.message}`
          : 'Layout generation failed',
      );
    } finally {
      isGenerating = false;
    }
  }

  function getWorkspaceContext() {
    const state = appStore.state;
    const agents = workspaceId
      ? selectForegroundWorkspaceAgents.select(state, workspaceId).map((s) => ({
          id: s.id,
          name: s.name || s.id,
          status: s.status,
        }))
      : [];

    const notes = selectAllNotes.select(state, workspaceId).map((n) => ({
      id: n.id,
      title: n.title,
    }));

    return { agents, notes };
  }

  function buildLayoutPrompt(userPrompt: string): string {
    const { agents, notes } = getWorkspaceContext();
    const agentCount = agents.length;

    return `You are a layout configuration assistant. Generate a FLAT panel layout.

Available agents (${agentCount} total): ${JSON.stringify(agents)}
Available notes: ${JSON.stringify(notes)}

User request: "${userPrompt}"

RULES:
1. Use ONLY type values: "single" (1 panel), "split-horizontal" (2 panels side by side), "split-vertical" (2 panels stacked), "three-column" (3 panels), "grid-2x2" (4 panels)
2. panels array must be FLAT - each panel object has "tabs" array directly, NO nesting
3. Number of panels must match the type (single=1, split=2, three-column=3, grid-2x2=4)
4. Use actual agent IDs from the available agents list above

Respond with ONLY:
<layout>
{
  "type": "three-column",
  "panels": [
    { "tabs": [{ "type": "agent", "agentId": "agent-xxx" }] },
    { "tabs": [{ "type": "agent", "agentId": "agent-yyy" }] },
    { "tabs": [{ "type": "agent", "agentId": "agent-zzz" }] }
  ],
  "sizes": [33, 34, 33]
}
</layout>`;
  }

  function parseLayoutResponse(
    response: string,
  ): { type: string; panels: any[]; sizes?: number[] } | null {
    const match = response.match(/<layout>([\s\S]*?)<\/layout>/);
    if (!match) return null;

    try {
      return JSON.parse(match[1].trim());
    } catch {
      return null;
    }
  }

  function applyParsedLayout(layout: { type: string; panels: any[]; sizes?: number[] }) {
    const layoutManager = getPanelLayoutManager(workspaceId);
    if (!layoutManager) return;

    // First apply the structural preset
    layoutManager.applyPreset(
      layout.type as 'single' | 'split-horizontal' | 'split-vertical' | 'three-column',
    );

    // Dispatch event to PanelLayout to handle the tab configuration
    document.dispatchEvent(
      new CustomEvent('layout:configure-panels', {
        detail: { panels: layout.panels, sizes: layout.sizes, type: layout.type, workspaceId },
        bubbles: true,
      }),
    );
  }
</script>

<!-- Minimap triggers preset dropdown with AI input and navigation -->
<LayoutPresetDropdown
  {workspaceId}
  {currentPreset}
  onApplyPreset={(presetId) => {
    onApplyPreset(presetId);
    promptValue = '';
  }}
  {promptValue}
  {isGenerating}
  onPromptChange={(value) => (promptValue = value)}
  onGenerateLayout={handleGenerateLayout}
  onPromptKeydown={handlePromptKeydown}
  {canGoBack}
  {canGoForward}
  {onGoBack}
  {onGoForward}
>
  {#snippet children({ toggle })}
    <PanelMinimap {layoutRoot} onclick={toggle} />
  {/snippet}
</LayoutPresetDropdown>
