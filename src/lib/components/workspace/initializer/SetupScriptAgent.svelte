<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import StreamingMessageContent from '$lib/components/chat/StreamingMessageContent.svelte';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';
  import { faStop, faTimes, faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { ContentBlock } from '$shared/types';

  const logger = createLogger('SetupScriptAgent');

  interface Props {
    repoPath: string;
    onScriptGenerated?: (script: { name: string; description: string; content: string }) => void;
    onClose?: () => void;
  }

  let { repoPath, onScriptGenerated, onClose }: Props = $props();

  let agentId = $state(crypto.randomUUID());
  let isStreaming = $state(false);
  let streamContent = $state('');
  let contentBlocks = $state<ContentBlock[]>([]);
  let error = $state<string | null>(null);
  let streamCleanup: (() => void) | null = null;
  let generatedScript = $state<{ name: string; description: string; content: string } | null>(null);

  // Start the agent when mounted
  onMount(() => {
    startAgent();
  });

  onDestroy(() => {
    cleanup();
  });

  function cleanup() {
    if (streamCleanup) {
      streamCleanup();
      streamCleanup = null;
    }
  }

  async function startAgent() {
    isStreaming = true;
    error = null;
    streamContent = '';
    contentBlocks = [];

    try {
      // Start streaming response
      const result = await invoke<{
        success: boolean;
        streamId?: string;
        error?: string;
      }>('setup-scripts:generate-with-agent', {
        repoPath,
        agentId,
      });

      if (!result.success) {
        error = result.error || 'Failed to start agent';
        isStreaming = false;
        return;
      }

      // Listen for stream events
      const streamId = result.streamId;
      if (streamId) {
        setupStreamListener(streamId);
      }
    } catch (err) {
      logger.error('Failed to start setup script agent', err);
      error = err instanceof Error ? err.message : 'Failed to start agent';
      isStreaming = false;
    }
  }

  function setupStreamListener(streamId: string) {
    // Listen for stream chunks - electronAPI.on passes data directly (not as second param)
    const handleChunk = (data: { streamId: string; chunk: string }) => {
      if (data.streamId === streamId) {
        streamContent += data.chunk;
        updateContentBlocks();
        checkForSetupScript();
      }
    };

    const handleComplete = (data: { streamId: string }) => {
      if (data.streamId === streamId) {
        isStreaming = false;
        checkForSetupScript();
      }
    };

    const handleError = (data: { streamId: string; error: string }) => {
      if (data.streamId === streamId) {
        error = data.error;
        isStreaming = false;
      }
    };

    // Register listeners via electronAPI - use ID-based removal for reliable cleanup
    const chunkListenerId = window.electronAPI?.on('setup-scripts:stream-chunk', handleChunk);
    const completeListenerId = window.electronAPI?.on('setup-scripts:stream-complete', handleComplete);
    const errorListenerId = window.electronAPI?.on('setup-scripts:stream-error', handleError);

    streamCleanup = () => {
      if (chunkListenerId) window.electronAPI?.offById('setup-scripts:stream-chunk', chunkListenerId);
      if (completeListenerId)
        window.electronAPI?.offById('setup-scripts:stream-complete', completeListenerId);
      if (errorListenerId) window.electronAPI?.offById('setup-scripts:stream-error', errorListenerId);
    };
  }

  function stripAnsi(text: string): string {
    return text.replace(/\x1B\[\d*;?\d*m/g, '');
  }

  function cleanStreamContent(raw: string): string {
    return stripAnsi(raw)
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        // Filter out thinking lines, system markers, and empty marker lines
        if (/^>\s*Thinking:/i.test(trimmed)) return false;
        if (/^🤖/.test(trimmed)) return false;
        if (/^💻/.test(trimmed)) return false;
        if (/^⏳/.test(trimmed)) return false;
        if (/^🤔/.test(trimmed)) return false;
        return true;
      })
      .join('\n');
  }

  function updateContentBlocks() {
    const cleaned = cleanStreamContent(streamContent);
    contentBlocks = cleaned.trim() ? [{ type: 'text', text: cleaned }] : [];
  }

  function checkForSetupScript() {
    const script = AuggieTextParser.extractSetupScript(streamContent);
    if (script) {
      generatedScript = script;
    }
  }

  function handleUseScript(script: { name: string; description: string; content: string }) {
    onScriptGenerated?.(script);
  }

  async function handleStop() {
    try {
      await invoke('setup-scripts:stop-agent', { agentId });
    } catch (err) {
      logger.error('Failed to stop agent', err);
    }
    isStreaming = false;
    // Close the panel when stopped
    onClose?.();
  }
</script>

<div class="flex flex-col bg-background border border-border rounded-lg overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
    <div class="flex items-center gap-2">
      <AuggieAvatar size={20} faceSeed={agentId} colorSeed={agentId} />
      <span class="text-sm font-medium">Setup Script Generator</span>
      {#if isStreaming}
        <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      {#if isStreaming}
        <Button variant="ghost-light" size="sm" onclick={handleStop} class="h-7 px-2">
          <Fa icon={faStop} class="mr-1" />
          Stop
        </Button>
      {/if}
      <Button variant="ghost-light" size="sm" onclick={onClose} class="h-7 w-7 p-0">
        <Fa icon={faTimes} />
      </Button>
    </div>
  </div>

  <!-- Content - contained scroll that won't affect parent -->
  <div class="p-4 max-h-60 overflow-y-auto overscroll-contain">
    {#if error}
      <div class="text-sm text-destructive-foreground bg-destructive/10 rounded-md p-3">
        {error}
      </div>
    {:else if contentBlocks.length > 0}
      <StreamingMessageContent
        content={contentBlocks}
        {isStreaming}
        hideSetupScripts={true}
        onSetupScriptGenerated={handleUseScript}
      />
    {:else if isStreaming}
      <div class="flex items-center gap-2 text-muted-foreground">
        <div
          class="w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin"
        ></div>
        <span class="text-sm">Analyzing repository...</span>
      </div>
    {/if}
  </div>

  <!-- Generated Script Preview -->
  {#if generatedScript && !isStreaming}
    <div class="border-t border-border p-3 bg-muted/30">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <Fa icon={faCheck} class="text-green-500" />
          <span class="text-sm font-medium">{generatedScript.name}</span>
        </div>
        <Button
          variant="default"
          size="sm"
          onclick={() => handleUseScript(generatedScript!)}
          class="h-7"
        >
          Create Script
        </Button>
      </div>
      <p class="text-xs text-muted-foreground mb-2">{generatedScript.description}</p>
      <div class="h-32 rounded border border-border overflow-hidden">
        <CodeEditor
          value={generatedScript.content}
          language="shell"
          readOnly={true}
          lineNumbers={false}
        />
      </div>
    </div>
  {/if}
</div>
