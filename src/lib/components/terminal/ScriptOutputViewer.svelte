<script lang="ts">
  /**
   * ScriptOutputViewer — Renders script output using xterm.js in read-only mode.
   *
   * Header bar shows: script name, status badge, detected URL (clickable),
   * control buttons (restart/stop), and an editable command input.
   * Output streams in real-time via store subscription.
   * On re-open, loads buffered output from the store.
   */
  import {
  onDestroy,
  untrack,
} from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import '@xterm/xterm/css/xterm.css';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
  faXmark,
  faWandMagicSparkles,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { scriptsClient } from '$features/scripts/scripts.client';


  import {
  selectScriptById,
  selectScriptRuntime,
  selectScriptOutput,
} from '$store/renderer/slices/scripts/scripts-selectors';
  import { removeScript } from '$store/renderer/slices/scripts/scripts-slice';
  import { scriptOutputTailText } from '$lib/utils/script-output-text';
  import { TerminalThemeManager } from '$features/terminal/terminal-theme-manager';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { createAgentFromConfigRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';


  interface Props {
    scriptId: string;
    workspaceId: string;
    class?: string;
    onDelete?: () => void;
  }

  let { scriptId, workspaceId, class: className = '', onDelete }: Props = $props();

  // xterm state
  let xtermContainer: HTMLDivElement;
  let xterm: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeManager: TerminalThemeManager | null = null;
  let initRafId: number | null = null;
  let fitRafId: number | null = null;



  // Reactive state from Redux store
  const script$ = selectScriptById(scriptId);
  const runtime$ = selectScriptRuntime(scriptId);
  const output$ = selectScriptOutput(scriptId);

  // Stream position already written to xterm: buffer.dropped + chunk index.
  let writtenChunkCount = $state(0);

  const isFailing = $derived(
    $runtime$.status === 'exited' &&
      $runtime$.exitCode != null &&
      $runtime$.exitCode !== 0 &&
      $runtime$.exitCode < 128,
  );

  // ---- xterm lifecycle ----

  function initXterm(): void {
    if (!xtermContainer || xterm) return;

    themeManager = new TerminalThemeManager(xtermContainer);
    const theme = themeManager.getCurrentTheme();

    xterm = new Terminal({
      allowProposedApi: true,
      fontFamily: '"SF Mono", Monaco, Menlo, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: false,
      cursorStyle: 'underline',
      cursorWidth: 1,
      scrollback: 10000,
      allowTransparency: true,
      convertEol: true,
      disableStdin: true, // Read-only
      drawBoldTextInBrightColors: true,
      theme,
    });

    // Pass through global keyboard shortcuts instead of capturing them
    xterm.attachCustomKeyEventHandler((event) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key === '`') return false;
      if (isMod && event.key === 'j') return false;
      if (isMod && event.key === 'k') return false;
      return true;
    });

    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      // Open localhost URLs in browser panel, others externally
      try {
        const url = new URL(uri);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          import('$features/layout/panel-layout-adapter')
            .then(({ getPanelLayoutManager }) => {
              const layoutManager = getPanelLayoutManager(workspaceId);
              layoutManager.openBrowserPanel(uri);
            })
            .catch(() => {
              window.open(uri, '_blank');
            });
        } else {
          window.open(uri, '_blank');
        }
      } catch {
        window.open(uri, '_blank');
      }
    });
    xterm.loadAddon(webLinksAddon);

    xterm.open(xtermContainer);

    // Apply theme
    themeManager.applyTheme(xterm);

    // Fit after a tick to ensure container has dimensions
    fitRafId = requestAnimationFrame(() => {
      fitRafId = null;
      fitAddon?.fit();
    });

    // Resize observer
    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(xtermContainer);

    // Load buffered output
    loadBufferedOutput();
  }

  function loadBufferedOutput(): void {
    if (!xterm) return;
    const buffer = selectScriptOutput.select(appStore.state, scriptId);
    if (buffer.chunks.length > 0) {
      // Replay the raw stream verbatim — plain concatenation, no separators.
      xterm.write(buffer.chunks.map((c) => c.text).join(''));
    }
    writtenChunkCount = buffer.dropped + buffer.chunks.length;
  }

  function disposeXterm(): void {
    if (initRafId !== null) {
      cancelAnimationFrame(initRafId);
      initRafId = null;
    }
    if (fitRafId !== null) {
      cancelAnimationFrame(fitRafId);
      fitRafId = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    themeManager?.dispose();
    themeManager = null;
    xterm?.dispose();
    xterm = null;
    fitAddon = null;
    writtenChunkCount = 0;
  }

  // ---- Real-time streaming via $effect ----

  $effect(() => {
    const buffer = $output$; // tracked — triggers effect on new output
    const written = untrack(() => writtenChunkCount); // NOT tracked — avoids cycle
    const total = buffer.dropped + buffer.chunks.length;
    if (!xterm || total <= written) return;

    // Write only chunks not yet rendered, verbatim — no injected newlines.
    const startIndex = Math.max(written - buffer.dropped, 0);
    xterm.write(buffer.chunks.slice(startIndex).map((c) => c.text).join(''));
    writtenChunkCount = total;
  });

  // ---- Start ----

  async function handleStart(): Promise<void> {
    await scriptsClient.start(workspaceId, scriptId);
  }

  // ---- Delete ----

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleDelete(): Promise<void> {
    await scriptsClient.remove(workspaceId, scriptId);
    appStore.dispatch(removeScript(workspaceId, scriptId));
    onDelete?.();
  }

  // ---- Ask Agent ----

  async function handleAskAgent(): Promise<void> {
    if (!workspaceId) {
      toast.error(m.terminal_scriptOutput_noWorkspace_error());
      return;
    }

    const buffer = selectScriptOutput.select(appStore.state, scriptId);
    const lastLines = scriptOutputTailText(buffer, 100);
    const exitCode = $runtime$.exitCode;
    const failedText =
      exitCode !== null && exitCode !== 0 ? ` failed with exit code ${exitCode}` : '';

    // i18n-ignore (agent-facing prompt, kept in English)
    const prompt = `The script '${$script$?.name}'${failedText}.\n\nCommand: \`${$script$?.command}\`\n\nOutput (last 100 lines):\n\`\`\`\n${lastLines}\n\`\`\`\n\nPlease analyze the error and suggest how to fix this script. If you can identify the issue, update the script command using the \`create_script\` MCP tool with scriptId="${scriptId}".`;

    try {
      appStore.dispatch(createAgentFromConfigRequested(workspaceId, {
        name: m.terminal_scriptOutput_fixAgentName_label({
          name: $script$?.name ?? m.terminal_scriptOutput_script_fallback(),
        }),
        // Derived from the script name, not user-chosen — keep the session
        // self-renameable.
        nameExplicitlySet: false,
        workspaceId: WorkspaceId(workspaceId),
        initialMessage: prompt,
        source: 'error-notification',
      }, { openAgent: true }));
    } catch {
      toast.error(m.workspace_modals_createAgentFailed_error());
    }
  }

  // ---- Lifecycle ----

  // Reset xterm when transitioning back to empty state
  $effect(() => {
    const isEmptyState = $runtime$.status === 'idle' && $output$.chunks.length === 0;
    if (isEmptyState && xterm) {
      disposeXterm();
    }
  });

  // Initialize xterm when the container is visible (not during empty state)
  $effect(() => {
    const isEmptyState = $runtime$.status === 'idle' && $output$.chunks.length === 0;
    if (!isEmptyState && xtermContainer && !xterm) {
      // Container just became visible, initialize xterm
      // Use requestAnimationFrame to ensure DOM has updated
      if (initRafId !== null) {
        cancelAnimationFrame(initRafId);
      }
      initRafId = requestAnimationFrame(() => {
        initRafId = null;
        initXterm();
      });
    }
  });

  onDestroy(() => {
    disposeXterm();
  });
</script>

<!-- Script output viewer (no header - header is now in parent) -->
<div class="script-output-viewer {className}">
  {#if isFailing}
    <div class="bg-destructive/20 border-y border-destructive/20 px-3 py-1.5 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm text-destructive-foreground font-medium">
        <div class="w-4 h-4 rounded-full bg-destructive flex items-center justify-center">
          <Fa icon={faXmark} size="xs" />
        </div>
        <span>{m.terminal_scriptOutput_buildFailed_label({ exitCode: $runtime$.exitCode ?? 0 })}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        class="h-7 text-xs bg-background border border-border text-destructive-foreground"
        onclick={handleAskAgent}
      >
        <Fa icon={faWandMagicSparkles} size="sm" class="mr-1.5" />
        {m.terminal_scriptOutput_askAiToFix_label()}
      </Button>
    </div>
  {/if}

  {#if $runtime$.status === 'idle' && $output$.chunks.length === 0}
    <!-- Empty state: script hasn't been run yet -->
    <div class="flex-1 flex items-center justify-center px-4 py-8">
      <div class="flex items-center gap-3 text-sm">
        <span class="text-subtle font-mono">$</span>
        {#if $script$}
          <code class="text-muted-foreground font-mono text-xs">{$script$.command}</code>
        {/if}
        <Button
          variant="ghost"
          size="xs"
          onclick={handleStart}
          class="text-muted-foreground hover:text-foreground"
        >
          <Fa icon={faPlay} class="h-3 w-3 mr-1" />
          {m.terminal_scriptOutput_run_label()}
        </Button>
      </div>
    </div>
  {/if}

  <!-- xterm output (hidden when empty state is showing) -->
  <div class="flex-1 relative overflow-hidden" class:hidden={$runtime$.status === 'idle' && $output$.chunks.length === 0}>
    <div class="xterm-output" bind:this={xtermContainer}></div>
  </div>
</div>

<style>
  .script-output-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: var(--color-bg, #0b0b0e);
  }

  :global(.light) .script-output-viewer {
    background: var(--color-bg, #f7f7f8);
  }

  /* xterm output area */
  .xterm-output {
    flex: 1;
    position: relative;
    overflow: hidden;
    height: 100%;
  }

  :global(.xterm-output .xterm) {
    height: 100%;
    padding: 4px 8px;
  }

  :global(html.light .xterm-output .xterm) {
    -webkit-font-smoothing: subpixel-antialiased;
    -moz-osx-font-smoothing: auto;
  }

  :global(.dark .xterm-output .xterm) {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Scrollbar styles */
  :global(.xterm-output .xterm-viewport) {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  :global(.light .xterm-output .xterm-viewport) {
    scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
  }
</style>
