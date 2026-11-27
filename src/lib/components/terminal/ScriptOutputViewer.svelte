<script lang="ts">
  import { scriptCommandLabel } from '$features/scripts/types';
  /**
   * ScriptOutputViewer — Renders script output using xterm.js in read-only mode.
   *
   * Header bar shows: script name, status badge, detected URL (clickable),
   * control buttons (restart/stop), and an editable command input.
   * The retained `script.output` snapshot and the live stream share one
   * terminal: the snapshot first, then the live chunks that arrived after it.
   */
  import { onDestroy, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import '@xterm/xterm/css/xterm.css';
  import Fa from 'svelte-fa';
  import Button from '$lib/components/ui/button/button.svelte';
  import { faXmark, faWandMagicSparkles, faPlay } from '@fortawesome/free-solid-svg-icons';
  import { notify } from '$lib/components/patterns/notify';
  import ScrollToBottomButton from '$lib/components/chat/ScrollToBottomButton.svelte';
  import {
    retainedOutputIsComplete,
    retainedOutputTerminalText,
    snapshotRemainderAfterLive,
  } from './retained-output-text';
  import { resolveBrowserLinkForOpen } from '$lib/utils/browser-link-open';
  import { joinLiveChunk, joinSnapshot, streamKey, type StreamJoin } from './script-output-join';

  import {
    selectScriptById,
    selectScriptRuntime,
    selectScriptOutput,
    selectScriptRetainedOutput,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import type {
    ScriptOutputBuffer,
    ScriptRetainedOutput,
  } from '$store/renderer/slices/scripts/scripts-types';
  import { selectCodeFontFamilyCSS } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    selectWorkspaceScriptReadContext,
    selectHidesAgentLifecycleActions,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    startScriptRequested,
    scriptOutputRequested,
    scriptOutputReleased,
    createScriptFixAgentRequested,
    scriptWorkflowReleased,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { TerminalThemeManager } from '$features/terminal/terminal-theme-manager';
  import { disposeXtermAfterViewportSync } from '$features/terminal/utils/xterm-lifecycle';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    scriptId: string;
    workspaceId: string;
    class?: string;
    /** Running is unavailable (the workspace home is detached or moving); output stays readable. */
    runDisabled?: boolean;
    /** Why Run is unavailable; also disables it. */
    runDisabledReason?: string | null;
  }

  let {
    scriptId,
    workspaceId,
    class: className = '',
    runDisabled: runDisabledProp = false,
    runDisabledReason = null,
  }: Props = $props();
  const runDisabled = $derived(runDisabledProp || runDisabledReason !== null);
  const runDisabledReasonId = $props.id();

  const workspaceIdStore = writable('');
  const scriptIdStore = writable('');
  const viewerIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  $effect(() => scriptIdStore.set(scriptId));

  // xterm state
  let xtermContainer: HTMLDivElement;
  let xterm: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let themeManager: TerminalThemeManager | null = null;
  let initRafId: number | null = null;
  let fitRafId: number | null = null;

  // Reactive state from Redux store. Selector readables are created once at
  // component init and follow route-driven prop changes through readable args.
  const script$ = selectScriptById(workspaceIdStore, scriptIdStore);
  const runtime$ = selectScriptRuntime(workspaceIdStore, scriptIdStore);
  const output$ = selectScriptOutput(workspaceIdStore, scriptIdStore);
  const retainedOutput$ = selectScriptRetainedOutput(
    workspaceIdStore,
    scriptIdStore,
    viewerIdStore,
  );
  // "Ask AI to Fix" creates an agent (`agent.create`), refused (-32003) for a
  // collaborator connection: the affordance is withheld.
  const hidesAgentLifecycleActions$ = selectHidesAgentLifecycleActions(workspaceIdStore);
  // Canonical code-font preference: used to construct the read-only xterm
  // and to update its font option later without disposing/replaying output.
  const codeFontFamilyCSS = selectCodeFontFamilyCSS();
  const outputAuthority = selectWorkspaceScriptReadContext(workspaceIdStore);
  const fixAgentConsumerId = crypto.randomUUID();
  $effect(() => {
    const wsId = workspaceId;
    void scriptId;
    return () => {
      if (wsId) appStore.dispatch(scriptWorkflowReleased(wsId, fixAgentConsumerId));
    };
  });
  // `script.start` clears `startedAt`, so it changes at each new run and not on
  // URL, readiness or exit updates, which the live stream already shows.
  const runStartedAt = $derived($runtime$.startedAt ?? null);
  // Bumped when live output reveals a gap, to read a fresh snapshot.
  let refreshGeneration = $state(0);
  // The request follows admitted connection, run and viewer lifetimes. It
  // never starts/restores the script, and cleanup fences late snapshots.
  $effect(() => {
    const wsId = workspaceId;
    const id = scriptId;
    const authority = $outputAuthority;
    void runStartedAt;
    void refreshGeneration;
    if (!authority || !wsId || !id) return;
    const viewerId = crypto.randomUUID();
    viewerIdStore.set(viewerId);
    appStore.dispatch(scriptOutputRequested(wsId, id, viewerId));
    return () => appStore.dispatch(scriptOutputReleased(wsId, id, viewerId));
  });

  // Stream position already written to xterm: buffer.dropped + chunk index.
  let writtenChunkCount = $state(0);
  // The snapshot the terminal content starts with.
  let shownSnapshot: ScriptRetainedOutput | null = null;
  let shownRun: string | null = null;
  let showsSnapshotText = $state(false);
  let scrolledUp = $state(false);
  // With a positioned snapshot (`scriptOutputCursor: 1`), how far the
  // terminal has written the run's stream; `null` joins by heuristic.
  let streamJoin: StreamJoin | null = null;
  // Live output showed a gap or another run: positioned chunks from this
  // stream index wait for the fresh snapshot that settles them.
  let heldFrom: number | null = null;
  // Another run or boot seen in live output, awaiting its confirming snapshot.
  let unconfirmedStream: string | null = null;
  // Runs or boots a snapshot showed to be older than the joined stream.
  let staleStreams = new Set<string>();

  const retainedAvailable = $derived($retainedOutput$?.status === 'available');
  const hasLiveOutput = $derived($runtime$.status !== 'idle' || $output$.chunks.length > 0);
  // A re-request keeps the shown snapshot until its answer replaces it.
  const showTerminal = $derived(
    hasLiveOutput ||
      retainedAvailable ||
      (showsSnapshotText && $retainedOutput$?.status === 'loading'),
  );
  // An idle script waits for its snapshot before offering Run, so it does not flash.
  const showRunPrompt = $derived(!showTerminal && $retainedOutput$?.status !== 'loading');

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
      // OSC 8 hyperlinks: xterm's default opens a blank window and then loads the link in it.
      linkHandler: { activate: (_event, uri) => openLink(uri) },
      fontFamily: $codeFontFamilyCSS,
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

    // Open localhost URLs in browser panel (resolved through browser:resolve-url
    // first, so remote-mode loads land on the daemon host or a tunnel port), others externally.
    function openLink(uri: string) {
      try {
        const url = new URL(uri);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          void resolveBrowserLinkForOpen(uri).then((resolved) => {
            import('$features/layout/panel-layout-adapter')
              .then(({ getPanelLayoutManager }) => {
                const layoutManager = getPanelLayoutManager(workspaceId);
                layoutManager.openBrowserPanel(
                  resolved.url,
                  undefined,
                  undefined,
                  resolved.requestedUrl,
                );
              })
              .catch(() => {
                window.open(resolved.url, '_blank');
              });
          });
        } else {
          window.open(uri, '_blank');
        }
      } catch {
        window.open(uri, '_blank');
      }
    }
    const webLinksAddon = new WebLinksAddon((_event, uri) => openLink(uri));
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

    const updateScrolledUp = () => {
      const active = xterm?.buffer.active;
      scrolledUp = !!active && active.viewportY < active.baseY;
    };
    xterm.onScroll(updateScrolledUp);
    xterm.onWriteParsed(updateScrolledUp);

    const snapshot = untrack(() => $retainedOutput$);
    writeOutput(false, snapshot?.status === 'available' ? snapshot : undefined);
  }

  /**
   * Write the retained snapshot, then the raw live stream verbatim from the
   * position the snapshot covers. Without a snapshot, the whole buffered
   * stream is written.
   */
  function writeOutput(replace: boolean, snapshot: ScriptRetainedOutput | undefined): void {
    if (!xterm) return;
    const buffer = selectScriptOutput.select(appStore.state, workspaceId, scriptId);
    if (snapshot?.cursor) {
      writeJoined(buffer, snapshot);
      return;
    }
    streamJoin = null;
    if (replace) xterm.reset();
    if (snapshot) {
      shownSnapshot = snapshot;
      shownRun = untrack(() => runStartedAt);
    }
    // A capped snapshot is only the newest tail: when live output already holds
    // its start (another view kept the stream open), that output is the fuller
    // history, and only the rest of the snapshot is written after it.
    const text = snapshot?.text;
    const joined = Math.max((snapshot?.liveOffset ?? 0) - buffer.dropped, 0);
    const chunkText = (from: number, to?: number) =>
      buffer.chunks
        .slice(from, to)
        .map((c) => c.text)
        .join('');
    const remainder =
      text && !retainedOutputIsComplete(text)
        ? snapshotRemainderAfterLive(chunkText(0, joined), text)
        : undefined;
    showsSnapshotText = !!snapshot && remainder === undefined && !!text;
    let live: string;
    if (!snapshot) {
      live = chunkText(0);
    } else if (remainder !== undefined) {
      live = chunkText(0, joined) + remainder + chunkText(joined);
    } else {
      if (text) xterm.write(retainedOutputTerminalText(text));
      live = chunkText(joined);
    }
    if (live) xterm.write(live);
    writtenChunkCount = buffer.dropped + buffer.chunks.length;
  }

  /**
   * Join a positioned snapshot by stream position (PROTOCOL §5.8 output
   * cursors): it either continues the shown run (only its unseen bytes are
   * added) or replaces the terminal, and then the buffered chunks it does not
   * hold follow.
   */
  function writeJoined(buffer: ScriptOutputBuffer, snapshot: ScriptRetainedOutput): void {
    if (!xterm || !snapshot.cursor) return;
    const key = streamKey(snapshot.cursor.bootId, snapshot.cursor.runId);
    if (unconfirmedStream !== null && unconfirmedStream !== key)
      staleStreams.add(unconfirmedStream);
    unconfirmedStream = null;
    const shown = shownSnapshot?.cursor;
    const continues = shown !== undefined && streamKey(shown.bootId, shown.runId) === key;
    const applied = joinSnapshot(continues ? streamJoin : null, snapshot);
    if (applied.reset) xterm.reset();
    if (applied.text) xterm.write(applied.text);
    streamJoin = applied.join;
    shownSnapshot = snapshot;
    shownRun = untrack(() => runStartedAt);
    showsSnapshotText = snapshot.status === 'available';
    const resumeFrom = heldFrom;
    heldFrom = null;
    if (applied.reset) {
      const readFrom = snapshot.liveOffset ?? 0;
      writeJoinedChunks(buffer, buffer.dropped, readFrom, readFrom);
    } else {
      const from = Math.max(resumeFrom ?? writtenChunkCount, buffer.dropped);
      writeJoinedChunks(buffer, from, 0, writtenChunkCount);
    }
  }

  /**
   * Write buffered chunks from stream index `from` through the join. Chunks
   * before `readFrom` arrived before the snapshot read began, so they cannot
   * be newer than it. Notices before `noticesFrom` are already on screen or
   * predate the snapshot.
   */
  function writeJoinedChunks(
    buffer: ScriptOutputBuffer,
    from: number,
    readFrom: number,
    noticesFrom: number,
  ): void {
    if (!xterm || !streamJoin) return;
    let text = '';
    buffer.chunks.forEach((chunk, i) => {
      const index = buffer.dropped + i;
      if (index < from || !streamJoin) return;
      const step = joinLiveChunk(streamJoin, chunk);
      if (step.kind === 'skip') return;
      if (step.kind === 'write' && !chunk.position) {
        if (index >= noticesFrom) text += step.text;
        return;
      }
      if (index < readFrom || heldFrom !== null) return;
      if (step.kind === 'write') {
        text += step.text;
        streamJoin = step.join;
        return;
      }
      if (step.kind === 'foreign') {
        if (staleStreams.has(step.key)) return;
        unconfirmedStream = step.key;
      }
      heldFrom = index;
      refreshGeneration += 1;
    });
    if (text) xterm.write(text);
    writtenChunkCount = Math.max(writtenChunkCount, buffer.dropped + buffer.chunks.length);
  }

  function scrollToEnd(): void {
    xterm?.scrollToBottom();
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
    const terminalToDispose = xterm;
    xterm = null;
    fitAddon = null;
    writtenChunkCount = 0;
    streamJoin = null;
    heldFrom = null;
    unconfirmedStream = null;
    staleStreams = new Set();
    shownSnapshot = null;
    shownRun = null;
    showsSnapshotText = false;
    scrolledUp = false;
    if (terminalToDispose) {
      disposeXtermAfterViewportSync(terminalToDispose);
    }
  }

  // ---- Real-time streaming via $effect ----

  $effect(() => {
    const buffer = $output$; // tracked — triggers effect on new output
    const written = untrack(() => writtenChunkCount); // NOT tracked — avoids cycle
    const total = buffer.dropped + buffer.chunks.length;
    if (!xterm) return;
    if (total <= written) return;
    if (streamJoin) {
      writeJoinedChunks(buffer, written, 0, written);
      return;
    }

    // Write only chunks not yet rendered, verbatim — no injected newlines.
    const startIndex = Math.max(written - buffer.dropped, 0);
    xterm.write(
      buffer.chunks
        .slice(startIndex)
        .map((c) => c.text)
        .join(''),
    );
    writtenChunkCount = total;
  });

  // A newly answered snapshot replaces the terminal content. An empty answer
  // replaces only an earlier snapshot (a new run): before any snapshot, the live
  // bytes may be output the daemon no longer has.
  $effect(() => {
    const snapshot = $retainedOutput$;
    // A refresh that came back without positions cannot settle held output:
    // fall back to the text join rather than hold it forever.
    if (
      xterm &&
      heldFrom !== null &&
      snapshot &&
      snapshot.status !== 'loading' &&
      !snapshot.cursor
    ) {
      heldFrom = null;
      writeOutput(true, snapshot.status === 'available' ? snapshot : undefined);
      return;
    }
    if (!xterm || snapshot?.liveOffset === undefined || snapshot === shownSnapshot) return;
    if (snapshot.status !== 'available' && !shownSnapshot) {
      // Keep the live bytes on screen, and join later output by position.
      if (snapshot.cursor) {
        const { runId, bootId, end } = snapshot.cursor;
        streamJoin = { runId, bootId, next: end };
      }
      return;
    }
    if (snapshot.cursor) {
      writeOutput(true, snapshot);
      return;
    }
    // A capped refresh of the shown run, joined to the same unbroken stream, is
    // a shorter tail than the terminal already has. After a stream gap it may
    // hold output that was never streamed, so it replaces the terminal.
    const sameStream =
      shownSnapshot?.streamEpoch !== undefined &&
      snapshot.streamEpoch === shownSnapshot.streamEpoch &&
      untrack(() => runStartedAt) === shownRun;
    if (sameStream && snapshot.text && !retainedOutputIsComplete(snapshot.text)) {
      shownSnapshot = snapshot;
      return;
    }
    writeOutput(true, snapshot);
  });

  // Update font on the mounted xterm when the preference changes. Setting
  // `options.fontFamily` is a pure display update — no dispose, no output
  // replay, no lifecycle change.
  $effect(() => {
    const fontFamily = $codeFontFamilyCSS;
    if (xterm && xterm.options.fontFamily !== fontFamily) {
      xterm.options.fontFamily = fontFamily;
    }
  });

  // ---- Start ----

  function handleStart(): void {
    if (runDisabled) return;
    appStore.dispatch(startScriptRequested(workspaceId, scriptId));
  }

  // ---- Ask Agent ----

  function handleAskAgent(): void {
    if (!workspaceId) {
      notify.error(m.terminal_scriptOutput_noWorkspace_error());
      return;
    }

    appStore.dispatch(
      createScriptFixAgentRequested(
        workspaceId,
        scriptId,
        $retainedOutput$?.text,
        fixAgentConsumerId,
      ),
    );
  }

  // ---- Lifecycle ----

  // Reset xterm when there is nothing left to show
  $effect(() => {
    if (!showTerminal) {
      disposeXterm();
    }
  });

  // Initialize xterm when the container is visible
  $effect(() => {
    if (showTerminal && xtermContainer && !xterm) {
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
    <div
      class="bg-danger-background/20 border-y border-danger/20 px-3 py-1.5 flex items-center justify-between"
    >
      <div class="flex items-center gap-2 text-sm text-danger font-medium">
        <div class="w-4 h-4 rounded-full bg-danger-background flex items-center justify-center">
          <Fa icon={faXmark} size="xs" />
        </div>
        <span
          >{m.terminal_scriptOutput_buildFailed_label({ exitCode: $runtime$.exitCode ?? 0 })}</span
        >
      </div>
      {#if !$hidesAgentLifecycleActions$}
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-xs bg-background border border-border text-danger"
          onclick={handleAskAgent}
        >
          <Fa icon={faWandMagicSparkles} size="sm" class="mr-1.5" />
          {m.terminal_scriptOutput_askAiToFix_label()}
        </Button>
      {/if}
    </div>
  {/if}

  {#if showRunPrompt}
    <!-- Empty state: script hasn't been run yet -->
    <div class="flex-1 flex items-center justify-center px-4 py-8">
      <div class="flex items-center gap-3 text-sm">
        <span class="text-subtle font-mono">$</span>
        {#if $script$}
          <code class="text-muted-foreground font-mono text-xs">{scriptCommandLabel($script$)}</code
          >
        {/if}
        <Button
          variant="ghost"
          size="xs"
          disabled={runDisabled}
          tooltip={runDisabledReason ?? undefined}
          aria-label={m.terminal_scriptOutput_run_label()}
          aria-describedby={runDisabledReason ? runDisabledReasonId : undefined}
          onclick={handleStart}
          class="text-muted-foreground hover:text-foreground"
        >
          <Fa icon={faPlay} class="h-3 w-3 mr-1" />
          {m.terminal_scriptOutput_run_label()}
        </Button>
        {#if runDisabledReason}
          <span id={runDisabledReasonId} class="sr-only">{runDisabledReason}</span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="flex-1 relative overflow-hidden" class:hidden={!showTerminal}>
    <div class="xterm-output" bind:this={xtermContainer}></div>
    {#if scrolledUp}
      <div class="absolute right-4 bottom-3">
        <ScrollToBottomButton floating onclick={scrollToEnd} />
      </div>
    {/if}
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

  /*
   * xterm 6.0.0 regression: xterm.css ships a static background-color: #000 on
   * .xterm-viewport, which shows through as a black frame around the padded
   * canvas in light mode. Force it transparent so the theme-painted container
   * shows through. Remove once xtermjs/xterm.js#5781 (fix: #5782) ships.
   */
  :global(.xterm-output .xterm-viewport) {
    background-color: transparent !important;
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
