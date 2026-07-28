<script lang="ts">
  /**
   * SetupScriptBanner - Prompts users to create a setup script from their terminal commands
   *
   * Shown at the bottom of the terminal panel when:
   * 1. The terminal is open
   * 2. The workspace was not started with a setup script
   * 3. The user hasn't dismissed or closed the banner
   *
   * Features:
   * - Horizontal banner bar with close (session) and dismiss (permanent) actions
   * - Expandable editor side panel (slides in from right) pre-populated with recent commands
   * - Resizable panel (drag left edge), defaults to 640px, max 80vw
   * - Save script for future workspace creation
   */
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
  faWandMagicSparkles,
  faXmark,
  faFloppyDisk,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import { v4 as uuidv4 } from 'uuid';

  import {
  dismissSetupScriptBannerGlobally,
  saveScript,
} from '$store/renderer/slices/setup-scripts/setup-scripts-slice';
  import { selectIsSetupScriptBannerDismissed } from '$store/renderer/slices/setup-scripts/setup-scripts-selectors';
  import { terminalHistoryTracker } from '$features/terminal/terminal-history-tracker';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { toast } from 'svelte-sonner';
  import { createLogger } from '$lib/utils/client-logger';
  import { store as appStore } from '$store/renderer/store';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('SetupScriptBanner');

  // Store reference for Svelte 5 auto-subscription via $historyUpdateCounter
  const historyUpdateCounter = terminalHistoryTracker.updateCounter;

  interface Props {
    workspaceId: string;
  }

  let { workspaceId }: Props = $props();
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  const workspaceById = selectWorkspaceById(workspaceIdStore);
  const isDismissedStore = selectIsSetupScriptBannerDismissed(workspaceIdStore);

  // State
  let isOpen = $state(true); // persisted dismissal is owned by setup-scripts Redux state
  let isExpanded = $state(false);
  let scriptContent = $state('');
  let scriptName = $state(m.terminal_setupBanner_defaultName_label());
  let bannerEl = $state<HTMLDivElement | null>(null);
  let panelWidth = $state(640); // default ~40em
  let isResizing = $state(false);
  let repoHasSetupScript = $state<boolean | null>(null); // null = pending check

  // Detect Windows platform for script generation and editor language
  const isWindows =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');

  const MIN_PANEL_WIDTH = 320;
  const maxPanelWidth = $derived(
    typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.8) : 1200,
  );

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    function onMouseMove(ev: MouseEvent) {
      const delta = startX - ev.clientX;
      panelWidth = Math.min(maxPanelWidth, Math.max(MIN_PANEL_WIDTH, startWidth + delta));
    }

    function onMouseUp() {
      isResizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Get workspace info
  const workspace = $derived($workspaceById);
  const repoPath = $derived(workspace?.repositoryPath || '');

  const isDismissed = $derived($isDismissedStore);

  // Should show the banner?
  // Hide while the setup-script check is pending (avoid flash) and when a non-empty script exists
  const shouldShow = $derived(
    isOpen && !isDismissed && repoHasSetupScript === false,
  );

  // Check for existing setup script on mount and when workspaceId changes
  $effect(() => {
    const currentWorkspaceId = workspaceId;
    repoHasSetupScript = null; // reset to pending on workspaceId change

    void (async () => {
      try {
        const record = await appClient.setupScripts.get(currentWorkspaceId);
        // Only update if workspaceId hasn't changed while we were waiting
        if (currentWorkspaceId === workspaceId) {
          repoHasSetupScript = !!(record?.script && record.script.trim());
        }
      } catch {
        // On RPC failure, fall back to showing the banner (current behavior)
        if (currentWorkspaceId === workspaceId) {
          repoHasSetupScript = false;
        }
      }
    })();
  });

  // Get recent commands from all terminals in this workspace
  const recentCommands = $derived.by(() => {
    // Access the store value to establish dependency (triggers re-compute when history changes)
    void $historyUpdateCounter;

    const commands: Array<{ command: string; timestamp: number }> = [];
    const seen = new Set<string>();

    // Collect commands from all terminal histories already loaded by the tracker.
    for (const history of terminalHistoryTracker.getHistoriesForWorkspace(workspaceId)) {
      if (history.commands && Array.isArray(history.commands)) {
        for (const cmd of history.commands) {
          if (cmd.command && !seen.has(cmd.command)) {
            seen.add(cmd.command);
            commands.push({ command: cmd.command, timestamp: cmd.timestamp || 0 });
          }
        }
      }
    }

    // Also check the default terminal
    const defaultTerminalId = `terminal-${workspaceId}-default`;
    const defaultHistory = terminalHistoryTracker.getHistory(defaultTerminalId);
    if (defaultHistory?.commands) {
      for (const cmd of defaultHistory.commands) {
        if (cmd.command && !seen.has(cmd.command)) {
          seen.add(cmd.command);
          commands.push({ command: cmd.command, timestamp: cmd.timestamp });
        }
      }
    }

    // Sort by timestamp ascending (chronological order for setup script)
    commands.sort((a, b) => a.timestamp - b.timestamp);
    return commands;
  });

  // Functions
  function close() {
    isOpen = false;
    isExpanded = false;
  }

  function dismiss() {
    appStore.dispatch(dismissSetupScriptBannerGlobally());
    isExpanded = false;
    isOpen = false;
  }

  function handleSave() {
    if (!scriptContent.trim()) {
      toast.error(m.terminal_setupBanner_emptyScript_error());
      return;
    }

    const now = new Date().toISOString();
    appStore.dispatch(saveScript({
      id: uuidv4(),
      name: scriptName || m.terminal_setupBanner_defaultName_label(),
      content: scriptContent,
      repoPath: repoPath || undefined,
      lastUsedAt: now,
      usageCount: 1,
      createdAt: now,
    }));

    toast.success(m.terminal_setupBanner_saved_success({ name: scriptName }));
    logger.info('Setup script saved from terminal banner', { repoPath, scriptName });
    dismiss();
  }

  // Build script content from commands
  function buildScriptFromCommands(cmds: Array<{ command: string }>): string {
    // i18n-ignore (generated script header comment, not UI)
    const header = isWindows ? '# PowerShell setup script\n\n' : '#!/bin/bash\n\n';
    return header + cmds.map((c) => c.command).join('\n');
  }

  // Track the last auto-generated content so we can detect user edits.
  let lastAutoGenerated = '';

  // Auto-update script content when new commands come in, as long as the user
  // hasn't manually edited the content and the panel is expanded.
  // We read recentCommands and isExpanded as dependencies, but read scriptContent
  // via untrack to avoid creating a circular dependency.
  $effect(() => {
    // Establish dependencies on these reactive values
    const expanded = isExpanded;
    const cmds = recentCommands;

    if (!expanded || cmds.length === 0) return;

    const autoGenerated = buildScriptFromCommands(cmds);

    // Read scriptContent without tracking to avoid circular dependency
    const currentContent = untrack(() => scriptContent);

    // Update only if the editor still matches the last auto-generated content
    // (meaning the user hasn't manually edited it), or if it's empty.
    if (!currentContent || currentContent === lastAutoGenerated) {
      scriptContent = autoGenerated;
      lastAutoGenerated = autoGenerated;
    }
  });

  function handleExpand() {
    isExpanded = true;
  }
</script>

{#if shouldShow}
  <!-- Horizontal banner bar at bottom of terminal -->
  <div bind:this={bannerEl} class="setup-script-banner border-t border-border bg-muted/30 shrink-0">
    <div class="flex items-center gap-3 px-4 py-2">
      <div class="flex items-center gap-2 text-subtle">
        <Fa icon={faWandMagicSparkles} class="w-3.5 h-3.5 text-primary/70" />
      </div>
      <p class="text-sm text-subtle flex-1">
        <span class="text-muted-foreground font-medium"
          >{m.terminal_setupBanner_headline_label()}</span
        >
        {m.terminal_setupBanner_headline_suffix()}
      </p>
      <button
        type="button"
        class="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        onclick={dismiss}
      >
        {m.terminal_setupBanner_dontShowAgain_label()}
      </button>
      {#if isExpanded}
        <Button variant="outline" size="xs" onclick={() => (isExpanded = false)}>
          <Fa icon={faChevronRight} size="xs" />
          {m.terminal_setupBanner_closeEditor_label()}
        </Button>
      {:else}
        <Button variant="outline" size="xs" onclick={handleExpand}>
          {m.terminal_setupBanner_create_label()}
          <Fa icon={faChevronRight} size="xs" />
        </Button>
      {/if}
      <button
        type="button"
        class="p-1 text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
        onclick={close}
        aria-label={m.terminal_setupBanner_close_ariaLabel()}
      >
        <Fa icon={faXmark} size="xs" />
      </button>
    </div>
  </div>
{/if}

<!-- Editor side panel - slides in from the right, overlays terminal -->
{#if shouldShow && isExpanded}
  <div
    class="absolute top-0 right-0 border-l border-border bg-sidebar flex flex-col z-10"
    class:select-none={isResizing}
    style="width: {panelWidth}px; bottom: {bannerEl?.offsetHeight ?? 0}px"
    transition:fly={{ x: panelWidth, duration: 200, easing: cubicOut }}
  >
    <!-- Resize handle -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-20"
      onmousedown={startResize}
    ></div>

    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-border/50">
      <div class="flex items-start gap-2">
        <!-- <Fa icon={faWandMagicSparkles} class="w-3.5 h-3.5 text-primary/70 mt-1" /> -->
        <div class="flex flex-col">
          <span class="text-sm font-medium text-muted-foreground"
            >{m.terminal_setupBanner_create_label()}</span
          >
          <p class="text-xs text-subtle">
            {m.terminal_setupBanner_autorun_description()}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <Button variant="outline" size="xs" onclick={handleSave} disabled={!scriptContent.trim()}>
          <Fa icon={faFloppyDisk} size="xs" />
          {m.terminal_setupBanner_save_label()}
        </Button>
        <button
          type="button"
          class="p-1 text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
          onclick={() => (isExpanded = false)}
          aria-label={m.terminal_setupBanner_closeEditor_label()}
        >
          <Fa icon={faXmark} size="xs" />
        </button>
      </div>
    </div>

    <!-- Script name -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
      <span class="text-xs text-subtle">{m.terminal_setupBanner_name_label()}</span>
      <input
        type="text"
        bind:value={scriptName}
        class="flex-1 text-xs bg-transparent border-0 outline-none focus:outline-none text-foreground/80 placeholder:text-muted-foreground/40"
        placeholder={m.terminal_setupBanner_name_placeholder()}
      />
    </div>

    <!-- Editor -->
    <div class="flex-1 overflow-hidden">
      <CodeEditor
        bind:value={scriptContent}
        language={isWindows ? 'powershell' : 'shell'}
        lineNumbers={true}
        placeholder={m.terminal_setupBanner_editor_placeholder()}
      />
    </div>
  </div>
{/if}
