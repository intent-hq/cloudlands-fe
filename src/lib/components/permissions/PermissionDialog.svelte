<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '../../../shared/ipc-registry';

  interface PermissionRequest {
    requestId: string;
    sessionId: string;
    title: string;
    description?: string | null;
    options: Array<{
      id: string;
      label: string;
      description?: string;
      destructive?: boolean;
    }>;
    agentName?: string;
    riskLevel?: 'low' | 'medium' | 'high';
    timestamp: number;
  }

  let requests: PermissionRequest[] = $state([]);
  let currentRequest: PermissionRequest | null = $state(null);
  let selectedOption: string = $state('');
  let showDetails = $state(false);
  // Store the handler reference for cleanup
  let ipcHandler: ((request: PermissionRequest) => void) | null = null;

  function handleRequest(request: PermissionRequest) {
    requests = [...requests, request];
    if (!currentRequest) {
      currentRequest = request;
    }
  }

  async function handleDecision(optionId: string) {
    if (!currentRequest) return;

    // Send decision back to main process via IPC
    try {
      await invoke(IPC_CHANNELS.PERMISSION.RESPOND, {
        requestId: currentRequest.requestId,
        outcome: { outcome: 'selected', optionId },
      });
    } catch (error) {
      console.error('[PermissionDialog] Failed to send permission decision', error);
    }

    // Move to next request
    requests = requests.filter((r) => r.requestId !== currentRequest!.requestId);
    currentRequest = requests[0] || null;
    selectedOption = '';
    showDetails = false;
  }

  async function handleCancel() {
    if (!currentRequest) return;

    // Send cancellation back to main process via IPC
    try {
      await invoke(IPC_CHANNELS.PERMISSION.RESPOND, {
        requestId: currentRequest.requestId,
        outcome: { outcome: 'cancelled' },
      });
    } catch (error) {
      console.error('[PermissionDialog] Failed to send permission cancellation', error);
    }

    requests = requests.filter((r) => r.requestId !== currentRequest!.requestId);
    currentRequest = requests[0] || null;
  }

  function getRiskIcon(level?: string) {
    switch (level) {
      case 'high':
        return '⚠️';
      case 'medium':
        return '⚡';
      case 'low':
        return '✓';
      default:
        return '🔒';
    }
  }

  function getRiskColor(level?: string) {
    switch (level) {
      case 'high':
        return 'text-red-500 border-red-200 bg-red-50 dark:bg-red-900/30';
      case 'medium':
        return 'text-yellow-500 border-yellow-200 bg-yellow-50 dark:bg-yellow-900/30';
      case 'low':
        return 'text-green-500 border-green-200 bg-green-50 dark:bg-green-900/30';
      default:
        return 'text-blue-500 border-blue-200 bg-blue-50 dark:bg-blue-900/30';
    }
  }

  // Store listener ID for ID-based removal
  let ipcListenerId: string | null = null;

  onMount(() => {
    // Listen for permission requests from main process via IPC
    // Use window.electronAPI.on directly for IPC events from main process
    ipcHandler = (request: PermissionRequest) => {
      handleRequest(request);
    };

    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      // Use ID-based listener removal for reliable cleanup with context isolation
      ipcListenerId = (window as any).electronAPI.on(IPC_CHANNELS.PERMISSION.EVENT, ipcHandler);
    }
  });

  onDestroy(() => {
    // Clean up IPC listener using ID-based removal
    if (typeof window !== 'undefined' && (window as any).electronAPI && ipcListenerId) {
      (window as any).electronAPI.offById(IPC_CHANNELS.PERMISSION.EVENT, ipcListenerId);
    }
  });
</script>

{#if currentRequest}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    transition:fade={{ duration: 200 }}
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
      transition:scale={{ duration: 200, start: 0.95 }}
    >
      <!-- Header -->
      <div class="p-6 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class={`text-2xl p-2 rounded-lg border ${getRiskColor(currentRequest.riskLevel)}`}>
              {getRiskIcon(currentRequest.riskLevel)}
            </div>
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                Permission Request
              </h2>
              {#if currentRequest.agentName}
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  from {currentRequest.agentName}
                </p>
              {/if}
            </div>
          </div>
          {#if requests.length > 1}
            <span class="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded-full">
              {requests.length} pending
            </span>
          {/if}
        </div>
      </div>

      <!-- Content -->
      <div class="p-6">
        <h3 class="font-medium text-gray-900 dark:text-white mb-2">
          {currentRequest.title}
        </h3>

        {#if currentRequest.description}
          <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">
            {currentRequest.description}
          </p>
        {/if}

        <!-- Details Toggle -->
        {#if currentRequest.riskLevel}
          <button
            class="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4"
            onclick={() => (showDetails = !showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} details
          </button>

          {#if showDetails}
            <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
              <div class="flex items-center gap-2 mb-2">
                <span class="font-medium">Risk Level:</span>
                <span
                  class={`capitalize ${
                    currentRequest.riskLevel === 'high'
                      ? 'text-red-600'
                      : currentRequest.riskLevel === 'medium'
                        ? 'text-yellow-600'
                        : 'text-green-600'
                  }`}
                >
                  {currentRequest.riskLevel}
                </span>
              </div>
              <div class="text-gray-600 dark:text-gray-300">
                This action {currentRequest.riskLevel === 'high'
                  ? 'could make significant changes'
                  : currentRequest.riskLevel === 'medium'
                    ? 'may modify some data'
                    : 'is generally safe'} to your workspace.
              </div>
            </div>
          {/if}
        {/if}

        <!-- Options -->
        <div class="space-y-2 mb-4">
          {#each currentRequest.options as option (option.id)}
            <label
              class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
              {selectedOption === option.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'}"
            >
              <input
                type="radio"
                name="permission-option"
                value={option.id}
                bind:group={selectedOption}
                class="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500"
              />
              <div class="flex-1">
                <div class="font-medium text-gray-900 dark:text-white">
                  {option.label}
                </div>
                {#if option.description}
                  <div class="text-sm text-gray-500 dark:text-gray-400">
                    {option.description}
                  </div>
                {/if}
              </div>
            </label>
          {/each}
        </div>

        <!-- Actions -->
        <div class="flex gap-3">
          <button
            class="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300
                   rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            onclick={handleCancel}
          >
            Cancel
          </button>
          <button
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                   transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!selectedOption}
            onclick={() => handleDecision(selectedOption)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
