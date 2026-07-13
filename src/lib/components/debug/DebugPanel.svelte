<script lang="ts">
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('DebugPanel');

  import {
  debugConfig,
  type DebugFlags,
} from '$lib/config/debug';
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  import { Input } from '$lib/components/ui/input';
  import Fa from 'svelte-fa';
  import {
  faBug,
  faTimes,
  faRotate,
  faPlay,
  faStop,
  faChevronUp,
  faChevronDown,
  faWaveSquare,
} from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';
  import { invoke } from '$lib/electron-bridge';

  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { resetWorkspaceState } from '$store/renderer/slices/workspace/workspace-slice';
  import { store as appStore } from '$store/renderer/store';

  let flags: DebugFlags = $state(debugConfig.getAll());
  let isOpen = $state(false);
  let isCollapsed = $state(false); // New state for collapse/expand
  let isSimulatingCreation = $state(false);
  let originalPath = $state('');
  let isOnCreationPage = $state(false);

  // Backend resume test state
  let backendResumeStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let backendResumeError = $state<string | null>(null);
  let availableAgents = $state<Array<{ id: string; name: string; status: string }>>([]);
  let selectedAgentId = $state<string>('');

  // Detect if on Mac
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  // Check if we're on the creation page (home page with create param, or just home)
  $effect(() => {
    isOnCreationPage =
      window.location.pathname === '/' && window.location.search.includes('create=true');

    // Load simulation state from sessionStorage
    const savedSimulation = sessionStorage.getItem('debug-simulation-state');
    if (savedSimulation) {
      const state = JSON.parse(savedSimulation);
      isSimulatingCreation = state.isSimulating;
      originalPath = state.originalPath || '';

      // If we're not on creation page anymore but simulation is active, clear it
      if (!isOnCreationPage && isSimulatingCreation) {
        isSimulatingCreation = false;
        originalPath = '';
        sessionStorage.removeItem('debug-simulation-state');
      }
    }
  });

  onMount(() => {
    // Subscribe to flag changes
    const unsubscribe = debugConfig.subscribe((newFlags) => {
      flags = newFlags;
    });

    // Watch for the showDebugInfo flag
    $effect(() => {
      isOpen = flags.showDebugInfo;
    });

    return unsubscribe;
  });

  function handleToggle(key: keyof DebugFlags) {
    debugConfig.toggle(key);
    flags = debugConfig.getAll();
  }

  function handleNumberChange(key: keyof DebugFlags, value: string) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      debugConfig.set(key, num);
      flags = debugConfig.getAll();
    }
  }

  function handleReset() {
    if (confirm('Reset all debug flags to defaults?')) {
      debugConfig.reset();
      flags = debugConfig.getAll();
    }
  }

  function handleClose() {
    debugConfig.set('showDebugInfo', false);
    isOpen = false;
  }

  function toggleCreationSimulation() {
    const currentPath = window.location.pathname;

    logger.info('[Debug] toggleCreationSimulation called', {
      isSimulatingCreation,
      originalPath,
      currentPath,
    });

    if (isSimulatingCreation) {
      // Stop simulation and go back to creation page
      logger.info('[Debug] Stopping simulation, navigating back to creation page');

      // Clear simulation state
      isSimulatingCreation = false;
      originalPath = '';
      sessionStorage.removeItem('debug-simulation-state');

      // Clear all simulation-related flags
      const simWorkspaceId = sessionStorage.getItem('simulated-workspace-id');
      if (simWorkspaceId) {
        sessionStorage.removeItem(`workspace-${simWorkspaceId}-simulated`);
        sessionStorage.removeItem(`workspace-${simWorkspaceId}-create-agent`);
        sessionStorage.removeItem(`workspace-${simWorkspaceId}-show-animation`);
        sessionStorage.removeItem(`workspace-${simWorkspaceId}-initial-prompt`);
        sessionStorage.removeItem('simulated-workspace-id');

        // Also remove the visited flag so it doesn't affect the real workspace
        localStorage.removeItem(`workspace-visited-${simWorkspaceId}`);

        // Clear drawer state for simulated workspace
        localStorage.removeItem(`workspace-drawer-state-${simWorkspaceId}`);
      }

      // Reset workspace store to clear simulated workspace
      appStore.dispatch(resetWorkspaceState());

      // Clear any workspace selection that might cause redirect
      sessionStorage.removeItem('last-workspace-id');
      localStorage.removeItem('selected-workspace-id');

      // Navigate immediately - the layout will handle clearing the workspace
      goto('/?create=true', { replaceState: true })
        .then(() => {
          logger.info('[Debug] Navigation back to creation page successful');
        })
        .catch((error) => {
          logger.error('[Debug] Navigation back failed:', error);
        });
    } else {
      // Start simulation - directly go to a fake workspace
      logger.info('[Debug] Starting workspace creation simulation');

      // Save current location
      originalPath = currentPath;
      isSimulatingCreation = true;

      // Save simulation state
      sessionStorage.setItem(
        'debug-simulation-state',
        JSON.stringify({
          isSimulating: true,
          originalPath: currentPath,
        }),
      );

      // Enable creation animation
      logger.info('[Debug] Enabling creation animation');
      debugConfig.set('enableCreationAnimation', true);
      flags = debugConfig.getAll();

      // Generate a fake workspace ID
      const simulatedWorkspaceId = `sim-${Date.now()}`;
      sessionStorage.setItem('simulated-workspace-id', simulatedWorkspaceId);

      // Set all the flags for the simulated workspace
      sessionStorage.setItem(`workspace-${simulatedWorkspaceId}-simulated`, 'true');
      sessionStorage.setItem(`workspace-${simulatedWorkspaceId}-create-agent`, 'true');
      sessionStorage.setItem(`workspace-${simulatedWorkspaceId}-show-animation`, 'true');
      sessionStorage.setItem(
        `workspace-${simulatedWorkspaceId}-initial-prompt`,
        'Help me refactor the authentication module',
      );

      logger.info('[Debug] Navigating to simulated workspace:', simulatedWorkspaceId);

      // Reset the workspace store to prevent components from using the old workspace
      // This ensures components will wait for the simulated workspace to be set
      appStore.dispatch(resetWorkspaceState());

      // Navigate directly to the simulated workspace
      goto(`/workspace/${simulatedWorkspaceId}`)
        .then(() => {
          logger.info('[Debug] Navigation to simulated workspace successful');
        })
        .catch((error) => {
          logger.error('[Debug] Navigation failed:', error);
          isSimulatingCreation = false;
          originalPath = '';
          sessionStorage.removeItem('debug-simulation-state');
          sessionStorage.removeItem('simulated-workspace-id');
        });
    }
  }

  // Load available agents from the unified state store
  function loadAvailableAgents() {
    const workspace = selectActiveWorkspace.select(appStore.state);
    if (!workspace?.id) {
      availableAgents = [];
      return;
    }

    // Get agents from Redux store
    const sessions = selectAllWorkspaceAgents.select(appStore.state, workspace.id);
    availableAgents = sessions.map((s) => ({
      id: s.id,
      name: s.name || 'Unnamed Agent',
      status: s.status || 'unknown',
    }));

    // Auto-select first agent if none selected
    if (availableAgents.length > 0 && !selectedAgentId) {
      selectedAgentId = availableAgents[0].id;
    }

    logger.info('[Debug] Loaded agents for backend resume test', {
      workspaceId: workspace.id,
      agentCount: availableAgents.length,
    });
  }

  // Trigger backend-initiated resume
  async function triggerBackendResume() {
    const workspace = selectActiveWorkspace.select(appStore.state);
    if (!workspace?.id || !selectedAgentId) {
      backendResumeError = 'No space or agent selected';
      backendResumeStatus = 'error';
      return;
    }

    backendResumeStatus = 'loading';
    backendResumeError = null;

    try {
      logger.info('[Debug] Triggering backend-initiated resume', {
        workspaceId: workspace.id,
        agentId: selectedAgentId,
      });

      const result = await invoke<{ success: boolean; error?: string }>(
        'debug:trigger-backend-resume',
        {
          workspaceId: workspace.id,
          agentId: selectedAgentId,
          message: `[DEBUG TEST] Backend-initiated wake at ${new Date().toLocaleTimeString()}. Testing frontend handshake flow.`,
        },
      );

      if (result.success) {
        backendResumeStatus = 'success';
        logger.info('[Debug] Backend resume triggered successfully');
      } else {
        backendResumeStatus = 'error';
        backendResumeError = result.error || 'Unknown error';
        logger.error('[Debug] Backend resume failed', { error: result.error });
      }
    } catch (error) {
      backendResumeStatus = 'error';
      backendResumeError = String(error);
      logger.error('[Debug] Backend resume error', { error });
    }
  }
</script>

{#if isOpen}
  <div
    class="fixed bottom-4 right-4 z-50 w-96 bg-background border border-border rounded-lg shadow-xl flex flex-col {isCollapsed
      ? 'max-h-[44px]'
      : 'max-h-[400px]'} transition-all duration-200"
  >
    <!-- Content (shown when not collapsed) -->
    {#if !isCollapsed}
      <div class="overflow-y-auto flex-1 p-3 space-y-3">
        <!-- Creation Simulation -->
        <div class="space-y-2">
          <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workspace Creation
          </h4>

          <button
            type="button"
            class="w-full h-7 px-2 rounded-md text-xs font-medium {isSimulatingCreation
              ? 'bg-destructive hover:bg-destructive/90 text-white'
              : isOnCreationPage
                ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'} transition-colors flex items-center justify-center gap-1.5"
            onclick={() => {
              logger.info('[Debug] Button clicked!');
              toggleCreationSimulation();
            }}
          >
            {#if isSimulatingCreation}
              <Fa icon={faStop} size="xs" />
              <span>Back to Creation Page</span>
            {:else}
              <Fa icon={faPlay} size="xs" />
              <span>Simulate Creation</span>
            {/if}
          </button>

          <p class="text-xs text-subtle leading-tight">
            {#if isSimulatingCreation}
              Currently viewing simulated workspace. Click to return.
            {:else}
              Navigate to fake workspace with animation and auto-created agent.
            {/if}
          </p>
        </div>

        <!-- Animation Settings -->
        <div class="space-y-2">
          <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Animations
          </h4>

          <div class="flex items-center justify-between">
            <Label for="creation-animation" class="text-sm">Creation Animation</Label>
            <Switch
              id="creation-animation"
              checked={flags.enableCreationAnimation}
              onCheckedChange={() => handleToggle('enableCreationAnimation')}
            />
          </div>

          <div class="flex items-center justify-between">
            <Label for="page-transitions" class="text-sm">Page Transitions</Label>
            <Switch
              id="page-transitions"
              checked={flags.enablePageTransitions}
              onCheckedChange={() => handleToggle('enablePageTransitions')}
            />
          </div>

          <div class="flex items-center justify-between">
            <Label for="component-transitions" class="text-sm">Component Transitions</Label>
            <Switch
              id="component-transitions"
              checked={flags.enableComponentTransitions}
              onCheckedChange={() => handleToggle('enableComponentTransitions')}
            />
          </div>

          <div class="space-y-1">
            <Label for="animation-duration" class="text-sm">Animation Duration (ms)</Label>
            <Input
              id="animation-duration"
              type="number"
              value={flags.animationDuration}
              onchange={(e) => handleNumberChange('animationDuration', e.currentTarget.value)}
              min="0"
              max="2000"
              step="50"
              class="h-8"
            />
          </div>
        </div>

        <!-- UI Behavior -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-subtle">UI Behavior</h4>

          <div class="flex items-center justify-between">
            <Label for="performance-metrics" class="text-sm">Performance Metrics</Label>
            <Switch
              id="performance-metrics"
              checked={flags.showPerformanceMetrics}
              onCheckedChange={() => handleToggle('showPerformanceMetrics')}
            />
          </div>

          <div class="flex items-center justify-between">
            <Label for="log-state" class="text-sm">Log State Changes</Label>
            <Switch
              id="log-state"
              checked={flags.logStateChanges}
              onCheckedChange={() => handleToggle('logStateChanges')}
            />
          </div>
        </div>

        <!-- Features -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-subtle">Features</h4>

          <div class="flex items-center justify-between">
            <Label for="autofocus" class="text-sm">Enable Autofocus</Label>
            <Switch
              id="autofocus"
              checked={flags.enableAutofocus}
              onCheckedChange={() => handleToggle('enableAutofocus')}
            />
          </div>

          <div class="flex items-center justify-between">
            <Label for="branch-caching" class="text-sm">Branch Caching</Label>
            <Switch
              id="branch-caching"
              checked={flags.enableBranchCaching}
              onCheckedChange={() => handleToggle('enableBranchCaching')}
            />
          </div>

          <div class="flex items-center justify-between">
            <Label for="form-persistence" class="text-sm">Form Persistence</Label>
            <Switch
              id="form-persistence"
              checked={flags.enableFormPersistence}
              onCheckedChange={() => handleToggle('enableFormPersistence')}
            />
          </div>
        </div>

        <!-- Testing Helpers -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-subtle">Testing</h4>

          <div class="flex items-center justify-between">
            <Label for="slow-network" class="text-sm">Simulate Slow Network</Label>
            <Switch
              id="slow-network"
              checked={flags.simulateSlowNetwork}
              onCheckedChange={() => handleToggle('simulateSlowNetwork')}
            />
          </div>

          <div class="flex items-center justify-between">
            <Label for="simulate-errors" class="text-sm">Simulate Errors</Label>
            <Switch
              id="simulate-errors"
              checked={flags.simulateErrors}
              onCheckedChange={() => handleToggle('simulateErrors')}
            />
          </div>

          <div class="space-y-1">
            <Label for="network-delay" class="text-sm">Network Delay (ms)</Label>
            <Input
              id="network-delay"
              type="number"
              value={flags.networkDelay}
              onchange={(e) => handleNumberChange('networkDelay', e.currentTarget.value)}
              min="0"
              max="5000"
              step="100"
              class="h-8"
              disabled={!flags.simulateSlowNetwork}
            />
          </div>
        </div>

        <!-- Backend Resume Test -->
        <div class="space-y-3">
          <h4 class="text-sm font-medium text-subtle flex items-center gap-2">
            <Fa icon={faWaveSquare} size="xs" />
            Backend Resume Test
          </h4>

          <p class="text-xs text-subtle">
            Test backend-initiated agent resume with frontend handshake.
          </p>

          <div class="space-y-2">
            <Button size="sm" variant="outline" onclick={loadAvailableAgents} class="w-full h-8">
              Load Agents
            </Button>

            {#if availableAgents.length > 0}
              <select
                bind:value={selectedAgentId}
                class="w-full h-8 px-2 text-sm bg-background border border-border rounded"
              >
                {#each availableAgents as agent (agent.id)}
                  <option value={agent.id}>{agent.name} ({agent.status})</option>
                {/each}
              </select>

              <Button
                size="sm"
                variant="default"
                onclick={triggerBackendResume}
                disabled={backendResumeStatus === 'loading'}
                class="w-full h-8"
              >
                {#if backendResumeStatus === 'loading'}
                  Triggering...
                {:else}
                  Trigger Backend Resume
                {/if}
              </Button>
            {:else}
              <p class="text-xs text-subtle italic">
                Click "Load Agents" to see available agents
              </p>
            {/if}

            {#if backendResumeStatus === 'success'}
              <p class="text-xs text-green-500">✓ Resume triggered successfully</p>
            {:else if backendResumeStatus === 'error'}
              <p class="text-xs text-red-500">✗ {backendResumeError}</p>
            {/if}
          </div>
        </div>

        <!-- Keyboard Shortcut Info -->
        <div class="pt-3 border-t border-border">
          <p class="text-xs text-subtle">
            Press <kbd class="px-1 py-0.5 bg-muted rounded text-xs">{isMac ? 'Cmd' : 'Ctrl'}</kbd> +
            <kbd class="px-1 py-0.5 bg-muted rounded text-xs">Shift</kbd> +
            <kbd class="px-1 py-0.5 bg-muted rounded text-xs">D</kbd> to toggle
          </p>
        </div>
      </div>
    {/if}

    <!-- Header (at bottom, always visible) -->
    <button
      type="button"
      class="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/50 shrink-0 hover:bg-muted/70 transition-colors cursor-pointer"
      onclick={() => (isCollapsed = !isCollapsed)}
      title="Click to {isCollapsed ? 'expand' : 'collapse'}"
    >
      <div class="flex items-center gap-2">
        <Fa icon={faBug} class="text-orange-500" size="sm" />
        <h3 class="font-medium text-sm">Debug Panel</h3>
        <Fa
          icon={isCollapsed ? faChevronUp : faChevronDown}
          class="text-subtle"
          size="xs"
        />
      </div>
      <div class="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onclick={(e) => {
            e.stopPropagation();
            handleReset();
          }}
          title="Reset to defaults"
          class="h-7 w-7 p-0"
        >
          <Fa icon={faRotate} size="xs" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onclick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          class="h-7 w-7 p-0"
        >
          <Fa icon={faTimes} size="xs" />
        </Button>
      </div>
    </button>
  </div>
{/if}
