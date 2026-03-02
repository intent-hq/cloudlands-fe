<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { formatDistanceToNow } from 'date-fns';
  import type {
    AgentEvent,
    AgentEventFilter,
  } from '../../features/observability/event-collector-client';
  import { AgentEventType } from '../../features/observability/event-collector-client';
  // import { fly } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { Logger } from '$shared/logger';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Fa from 'svelte-fa';
  import {
    faRocket,
    faCheckCircle,
    faExclamationCircle,
    faDownload,
    faUpload,
    faWrench,
    faCheck,
    faFile,
    faEdit,
    faTrash,
    faCodeBranch,
    faBrain,
    faLightbulb,
    faTriangleExclamation,
    faCircle,
    faPlay,
    faStop,
    faTerminal,
    faServer,
    faCog,
    faPlug,
    faPlugCircleXmark,
    faExternalLinkAlt,
    faFolderOpen,
  } from '@fortawesome/free-solid-svg-icons';
  import Input from '$lib/components/ui/input/input.svelte';

  const logger = new Logger('ObservabilityDashboard');

  let events: AgentEvent[] = $state([]);
  let selectedEvent: AgentEvent | null = $state(null);
  let isPaused: boolean = $state(false);
  let filter: string = $state('');
  let metrics = $state({
    totalEvents: 0,
    toolCalls: 0,
    errors: 0,
    filesModified: 0,
    totalTokens: 0,
    estimatedCost: 0,
  });

  let unsubscribe: (() => void) | null = null;
  let autoRefreshInterval: NodeJS.Timeout | null = null;

  onMount(async () => {
    // Load initial events
    await loadEvents();

    // Subscribe to real-time events if in Electron
    if (!isPaused && typeof window !== 'undefined' && window.electronAPI) {
      await subscribeToEvents();
    } else {
      // For browser context, set up auto-refresh
      startAutoRefresh();
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
    }
  });

  function startAutoRefresh() {
    // Auto-refresh every 2 seconds when in browser mode
    if (!autoRefreshInterval && !isPaused) {
      autoRefreshInterval = setInterval(() => {
        if (!isPaused) {
          loadEvents();
        }
      }, 2000);
    }
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  async function loadEvents() {
    try {
      // Check if we're in Electron context
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('observability:get-events', {
          filter: parseFilter(filter),
          limit: 1000,
        });

        if (result.success) {
          // Sort events by timestamp, newest first
          events = (result.data || []).sort(
            (a: AgentEvent, b: AgentEvent) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
          updateMetrics();
        }
      } else {
        // Fallback to API endpoint for web context
        logger.warn('Electron API not available - trying web API');
        try {
          const response = await fetch(
            `/api/observability/events?limit=1000&filter=${encodeURIComponent(filter)}`,
          );
          const result = await response.json();

          if (result.success) {
            // Sort events by timestamp, newest first
            events = (result.data.events || []).sort(
              (a: AgentEvent, b: AgentEvent) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
            );
            updateMetrics();

            if (result.data.message) {
              logger.info(result.data.message);
            }
          }
        } catch (apiError) {
          logger.error('Failed to load events from API:', apiError as Error);
          events = [];
        }
      }
    } catch (error) {
      logger.error('Failed to load events:', error as Error);
    }
  }

  async function subscribeToEvents() {
    try {
      // Check if we're in Electron context
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('observability:subscribe', {
          filter: parseFilter(filter),
        });

        if (result.success) {
          // Listen for events
          const handler = (event: AgentEvent) => {
            // Validate event before processing
            if (!event || typeof event !== 'object') {
              logger.warn('Received invalid event:', event);
              return;
            }

            if (!isPaused) {
              events = [event, ...events].slice(0, 1000);
              updateMetrics();
            }
          };

          // Use ID-based listener removal for reliable cleanup with context isolation
          const listenerId = window.electronAPI.on('observability:event', handler);

          // Create unsubscribe function using ID-based removal
          unsubscribe = () => {
            if (listenerId) {
              window.electronAPI.offById('observability:event', listenerId);
            }
          };
        }
      } else {
        logger.warn('Electron API not available - real-time events require Electron app');
      }
    } catch (error) {
      logger.error('Failed to subscribe to events:', error as Error);
    }
  }

  function parseFilter(filterStr: string): AgentEventFilter | undefined {
    if (!filterStr) return undefined;

    const filter: AgentEventFilter = {};

    // Simple filter parsing
    if (filterStr.includes('type:')) {
      const match = filterStr.match(/type:([^\s]+)/);
      if (match) {
        const typePattern = match[1];
        if (typePattern.includes('*')) {
          // Handle wildcards
          const prefix = typePattern.replace('*', '');
          filter.types = Object.values(AgentEventType).filter((t) => t.startsWith(prefix)) as any[];
        } else {
          filter.types = [typePattern as any];
        }
      }
    }

    if (filterStr.includes('actor:')) {
      const match = filterStr.match(/actor:([^\s]+)/);
      if (match) {
        filter.actorType = match[1] as any;
      }
    }

    // Text search
    if (!filterStr.includes(':')) {
      filter.search = filterStr;
    }

    return filter;
  }

  function updateMetrics() {
    const newMetrics = {
      totalEvents: events.length,
      toolCalls: 0,
      errors: 0,
      filesModified: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };

    for (const event of events) {
      if (event.type.includes('tool:call')) {
        newMetrics.toolCalls++;
      }
      if (event.type.includes('error')) {
        newMetrics.errors++;
      }
      if (event.type === 'file:modified') {
        newMetrics.filesModified++;
      }
      if (event.metadata?.tokenUsage) {
        newMetrics.totalTokens += event.metadata.tokenUsage.total;
      }
      if (event.metadata?.cost) {
        newMetrics.estimatedCost += event.metadata.cost;
      }
    }

    metrics = newMetrics;
  }

  function getEventIcon(type: string) {
    const icons: Record<string, any> = {
      'agent:started': faRocket,
      'agent:completed': faCheckCircle,
      'agent:error': faExclamationCircle,
      'auggie:command:executed': faTerminal,
      'message:received': faDownload,
      'message:sent': faUpload,
      'tool:call:started': faWrench,
      'tool:call:completed': faCheck,
      'tool:result': faCheck,
      'file:created': faFile,
      'file:modified': faEdit,
      'file:deleted': faTrash,
      'git:commit': faCodeBranch,
      'thinking:started': faBrain,
      'decision:made': faLightbulb,
      'error:occurred': faTriangleExclamation,
      'terminal:started': faTerminal,
      'terminal:output': faTerminal,
      'mcp:server:started': faServer,
      'mcp:server:stopped': faStop,
      'mcp:connected': faPlug,
      'mcp:disconnected': faPlugCircleXmark,
      'config:changed': faCog,
    };

    // Check for partial matches
    if (type.includes('error')) return faExclamationCircle;
    if (type.includes('command')) return faTerminal;
    if (type.includes('tool')) return faWrench;
    if (type.includes('file')) return faFile;
    if (type.includes('message')) return faDownload;
    if (type.includes('agent')) return faRocket;
    if (type.includes('terminal')) return faTerminal;
    if (type.includes('mcp')) return faServer;

    return icons[type] || faCircle;
  }

  function getEventIconClass(type: string): string {
    if (type.includes('error')) return 'icon-error';
    if (type.includes('completed') || type.includes('success')) return 'icon-success';
    if (type.includes('command')) return 'icon-terminal';
    if (type.includes('started') || type.includes('agent')) return 'icon-primary';
    if (type.includes('tool')) return 'icon-tool';
    if (type.includes('file')) return 'icon-file';
    if (type.includes('message')) return 'icon-message';
    if (type.includes('terminal')) return 'icon-terminal';
    if (type.includes('git')) return 'icon-git';
    return 'icon-default';
  }

  async function exportEvents() {
    try {
      const result = await window.electronAPI.invoke('observability:export', {
        filter: parseFilter(filter),
        format: 'json',
      });

      if (result.success) {
        // Download the file
        const blob = new Blob([result.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `events-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      logger.error('Failed to export events:', error as Error);
    }
  }

  async function openAgentFile(agentId: string) {
    try {
      // Get the workspace ID from the selected event
      const workspaceId = selectedEvent?.workspaceId;

      if (!workspaceId) {
        logger.warn('No workspace ID available');
        return;
      }

      // Build path to agent JSON file relative to workspace
      const agentFilePath = `.workspace/agents/${agentId}.json`;

      logger.info('Opening agent file:', agentFilePath);

      // Use the workspace store to open the file in the editor
      if (typeof window !== 'undefined' && window.electronAPI) {
        // Electron environment - open in VS Code or default editor
        const homeDir = await window.electronAPI.invoke('system:home-directory', undefined);
        const fullPath = `${homeDir}/intent/${workspaceId}/${agentFilePath}`;
        await window.electronAPI.invoke('shell:openPath', { path: fullPath });
      } else {
        // Browser environment - navigate to the file viewer
        // Navigate to the workspace file viewer with the agent file
        window.location.href = `/workspace/${workspaceId}/files?path=${encodeURIComponent(agentFilePath)}`;
      }
    } catch (error) {
      logger.error('Failed to open agent file:', error);
    }
  }

  function togglePause() {
    isPaused = !isPaused;

    // Handle Electron context
    if (typeof window !== 'undefined' && window.electronAPI) {
      if (!isPaused && !unsubscribe) {
        subscribeToEvents();
      }
    } else {
      // Handle browser context with auto-refresh
      if (isPaused) {
        stopAutoRefresh();
      } else {
        startAutoRefresh();
      }
    }
  }

  function applyFilter() {
    loadEvents();
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (!isPaused) {
      subscribeToEvents();
    }
  }
</script>

<div class="flex flex-col h-screen bg-background">
  <header class="flex items-center justify-between px-6 py-4 border-b border-border">
    <Header size={2}>Agent activity</Header>
    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" onclick={togglePause}>
        {isPaused ? '▶️ Resume' : '⏸️ Pause'}
      </Button>
      <Button variant="outline" size="sm" onclick={exportEvents}>📥 Export</Button>
    </div>
  </header>

  <div class="flex items-center gap-3 px-6 py-3 bg-muted/50 border-b border-border">
    <Input
      type="text"
      placeholder="Filter events (e.g., type:tool:*, error, actor:agent)"
      bind:value={filter}
      onkeydown={(e) => e.key === 'Enter' && applyFilter()}
      class="flex-1"
    />
    <Button variant="outline" size="sm" onclick={applyFilter}>Apply Filter</Button>
  </div>

  <div class="flex-1 flex overflow-hidden">
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-auto">
        <table class="w-full">
          <thead class="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr class="border-b border-border">
              <th
                class="px-2 py-1 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >Time</th
              >
              <th
                class="px-2 py-1 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >Type</th
              >
              <th
                class="px-2 py-1 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >Space</th
              >
              <th
                class="px-2 py-1 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >Actor</th
              >
              <th
                class="px-2 py-1 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                >Details</th
              >
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {#each events as event (event.id)}
              <tr
                class="hover:bg-muted/50 cursor-pointer transition-colors {selectedEvent?.id ===
                event.id
                  ? 'bg-muted'
                  : ''}"
                onclick={() => (selectedEvent = event)}
              >
                <td
                  class="px-2 py-1 text-xs text-subtle whitespace-nowrap"
                  title={new Date(event.timestamp).toLocaleString()}
                >
                  {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                </td>
                <td class="px-2 py-1 text-xs" title={event.type}>
                  <div class="flex items-center gap-1">
                    <span class={getEventIconClass(event.type)}>
                      <Fa icon={getEventIcon(event.type)} size="sm" />
                    </span>
                    <span class="font-mono text-xs">{event.type}</span>
                  </div>
                </td>
                <td
                  class="px-2 py-1 text-xs font-mono text-subtle truncate max-w-[100px]"
                  title={event?.workspaceId || '-'}
                >
                  {event?.workspaceId ? event.workspaceId.substring(0, 12) + '...' : '-'}
                </td>
                <td class="px-2 py-1 text-xs">
                  <div class="flex items-center gap-1">
                    {#if event.agentId}
                      <div title="Agent: {event.agentId}">
                        <AuggieAvatar
                          colorSeed={event.agentId}
                          faceSeed={event.agentId}
                          size={20}
                        />
                      </div>
                    {/if}
                    <span
                      class="text-subtle truncate max-w-[80px]"
                      title={event.actor?.name || event.actor?.id || 'System'}
                    >
                      {event.actor?.name || event.actor?.id || 'System'}
                    </span>
                  </div>
                </td>
                <td class="px-2 py-1 text-xs">
                  {#if event.type === 'auggie:command:executed' && event.data?.command}
                    <span
                      class="font-mono text-primary truncate max-w-[250px] block"
                      title={event.data.command}
                    >
                      <span class="text-subtle">$</span>
                      {event.data.command}
                    </span>
                  {:else if event.data?.messagePreview}
                    <span
                      class="text-subtle truncate max-w-[250px] block"
                      title={event.data.messagePreview}
                    >
                      {event.data.messagePreview.substring(0, 50)}{event.data.messagePreview
                        .length > 50
                        ? '...'
                        : ''}
                    </span>
                  {:else if event.data?.toolName}
                    <span class="font-mono text-primary">Tool: {event.data.toolName}</span>
                  {:else if event.data?.error}
                    <span
                      class="text-destructive-foreground truncate max-w-[250px] block"
                      title={event.data.error}
                    >
                      Error: {event.data.error.substring(0, 50)}{event.data.error.length > 50
                        ? '...'
                        : ''}
                    </span>
                  {:else}
                    <span class="text-subtle">-</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <div class="w-96 border-l border-border bg-card overflow-auto">
      {#if selectedEvent}
        <div class="p-4 space-y-4">
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Event ID</div>
            <p class="text-sm font-mono">{selectedEvent.id}</p>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Type</div>
            <div class="flex items-center gap-2">
              <span class={getEventIconClass(selectedEvent.type)}>
                <Fa icon={getEventIcon(selectedEvent.type)} size="sm" />
              </span>
              <span class="text-sm font-mono">{selectedEvent.type}</span>
            </div>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Timestamp</div>
            <p class="text-sm">{new Date(selectedEvent.timestamp).toLocaleString()}</p>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Session ID</div>
            <p class="text-sm font-mono">{selectedEvent.sessionId}</p>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Agent ID</div>
            <div class="flex items-center gap-2">
              {#if selectedEvent.agentId}
                <AuggieAvatar
                  colorSeed={selectedEvent.agentId}
                  faceSeed={selectedEvent.agentId}
                  size={32}
                />
                <div class="flex-1 flex items-center gap-2">
                  <span class="text-sm font-mono">{selectedEvent.agentId}</span>
                  <button
                    onclick={() => selectedEvent && openAgentFile(selectedEvent.agentId)}
                    class="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                    title="Open agent JSON file"
                  >
                    <Fa icon={faFolderOpen} size="sm" />
                  </button>
                </div>
              {:else}
                <span class="text-sm font-mono">-</span>
              {/if}
            </div>
          </div>
          {#if selectedEvent.correlationId}
            <div class="space-y-1">
              <div class="text-xs font-medium text-subtle">Correlation ID</div>
              <p class="text-sm font-mono">{selectedEvent.correlationId}</p>
            </div>
          {/if}
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Actor</div>
            <pre class="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(
                selectedEvent.actor,
                null,
                2,
              )}</pre>
          </div>
          <div class="space-y-1">
            <div class="text-xs font-medium text-subtle">Data</div>
            <pre class="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(
                selectedEvent.data,
                null,
                2,
              )}</pre>
          </div>
          {#if selectedEvent.type === AgentEventType.AGENT_STARTED && selectedEvent.data?.hasRules}
            <div class="space-y-1">
              <div class="text-xs font-medium text-subtle">
                Agent Rules
                <span class="text-green-500 ml-1">✓ Applied</span>
              </div>
              {#if selectedEvent.data?.instructionPreview}
                <div class="text-xs bg-muted p-2 rounded overflow-x-auto">
                  <div class="font-mono whitespace-pre-wrap">
                    {selectedEvent.data.instructionPreview}...
                  </div>
                  <div class="text-subtle mt-2">
                    (Full rules applied to agent system prompt)
                  </div>
                </div>
              {/if}
            </div>
          {/if}
          {#if selectedEvent.metadata}
            <div class="space-y-1">
              <div class="text-xs font-medium text-subtle">Metadata</div>
              <pre class="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(
                  selectedEvent.metadata,
                  null,
                  2,
                )}</pre>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex items-center justify-center h-full text-subtle text-sm">
          Select an event to view details
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Icon color classes */
  .icon-error {
    color: #ef4444;
  }

  .icon-success {
    color: #10b981;
  }

  .icon-primary {
    color: #3b82f6;
  }

  .icon-tool {
    color: #8b5cf6;
  }

  .icon-file {
    color: #f59e0b;
  }

  .icon-message {
    color: #06b6d4;
  }

  .icon-terminal {
    color: #6b7280;
  }

  .icon-git {
    color: #f97316;
  }

  .icon-default {
    color: var(--color-text-secondary);
  }

  :global(.dark) .icon-error {
    color: #f87171;
  }

  :global(.dark) .icon-success {
    color: #34d399;
  }

  :global(.dark) .icon-primary {
    color: #60a5fa;
  }

  :global(.dark) .icon-tool {
    color: #a78bfa;
  }

  :global(.dark) .icon-file {
    color: #fbbf24;
  }

  :global(.dark) .icon-message {
    color: #22d3ee;
  }

  :global(.dark) .icon-terminal {
    color: #9ca3af;
  }

  :global(.dark) .icon-git {
    color: #fb923c;
  }
</style>
