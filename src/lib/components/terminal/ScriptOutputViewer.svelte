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
} from '$lib/store/slices/scripts/scripts-selectors';
  import { removeScript } from '$lib/store/slices/scripts/scripts-slice';
  import { TerminalThemeManager } from '$features/terminal/terminal-theme-manager';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { createAgentFromConfigRequested } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$lib/store/store';


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



  // Reactive state from Redux store
  const script$ = selectScriptById(scriptId);
  const runtime$ = selectScriptRuntime(scriptId);
  const outputLines$ = selectScriptOutput(scriptId);

  // Track how many lines we've already written to xterm
  let writtenLineCount = $state(0);

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
    requestAnimationFrame(() => {
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
    const lines = selectScriptOutput.select(appStore.state, scriptId);
    if (lines.length > 0) {
      const text = lines.map((l) => l.text).join('\n');
      xterm.write(text);
      writtenLineCount = lines.length;
    }
  }

  function disposeXterm(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    themeManager?.dispose();
    themeManager = null;
    xterm?.dispose();
    xterm = null;
    fitAddon = null;
    writtenLineCount = 0;
  }

  // ---- Real-time streaming via $effect ----

  $effect(() => {
    const lines = $outputLines$; // tracked — triggers effect on new output
    const written = untrack(() => writtenLineCount); // NOT tracked — avoids cycle
    if (!xterm || lines.length <= written) return;

    const newLines = lines.slice(written);
    const text = newLines.map((l) => l.text).join('\n');
    if (written > 0) {
      xterm.write('\n' + text);
    } else {
      xterm.write(text);
    }
    writtenLineCount = lines.length;
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
      toast.error('No workspace selected');
      return;
    }

    const lines = selectScriptOutput.select(appStore.state, scriptId);
    const lastLines = lines
      .slice(-100)
      .map((l) => l.text)
      .join('\n');
    const exitCode = $runtime$.exitCode;
    const failedText =
      exitCode !== null && exitCode !== 0 ? ` failed with exit code ${exitCode}` : '';

    const prompt = `The script '${$script$?.name}'${failedText}.\n\nCommand: \`${$script$?.command}\`\n\nOutput (last 100 lines):\n\`\`\`\n${lastLines}\n\`\`\`\n\nPlease analyze the error and suggest how to fix this script. If you can identify the issue, update the script command using the \`create_script\` MCP tool with scriptId="${scriptId}".`;

    try {
      appStore.dispatch(createAgentFromConfigRequested(workspaceId, {
        name: `Fix: ${$script$?.name ?? 'script'}`,
        workspaceId: WorkspaceId(workspaceId),
        initialMessage: prompt,
        source: 'error-notification',
      }, { openAgent: true }));
    } catch {
      toast.error('Failed to create agent');
    }
  }

  // ---- Lifecycle ----

  // Reset xterm when transitioning back to empty state
  $effect(() => {
    const isEmptyState = $runtime$.status === 'idle' && $outputLines$.length === 0;
    if (isEmptyState && xterm) {
      disposeXterm();
    }
  });

  // Initialize xterm when the container is visible (not during empty state)
  $effect(() => {
    const isEmptyState = $runtime$.status === 'idle' && $outputLines$.length === 0;
    if (!isEmptyState && xtermContainer && !xterm) {
      // Container just became visible, initialize xterm
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
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
        <span>Build failed with exit code {$runtime$.exitCode}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        class="h-7 text-xs bg-background border border-border text-destructive-foreground"
        onclick={handleAskAgent}
      >
        <Fa icon={faWandMagicSparkles} size="sm" class="mr-1.5" />
        Ask AI to Fix
      </Button>
    </div>
  {/if}

  {#if $runtime$.status === 'idle' && $outputLines$.length === 0}
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
          Run
        </Button>
      </div>
    </div>
  {/if}

  <!-- xterm output (hidden when empty state is showing) -->
  <div class="flex-1 relative overflow-hidden" class:hidden={$runtime$.status === 'idle' && $outputLines$.length === 0}>
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
