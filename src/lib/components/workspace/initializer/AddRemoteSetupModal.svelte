<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Fa from 'svelte-fa';
  import {
  faXmark,
  faServer,
  faKey,
} from '@fortawesome/free-solid-svg-icons';
  import {
  fade,
  scale,
} from 'svelte/transition';
  import { scaleConfig } from '$lib/utils/animations';
  import { createLogger } from '$lib/utils/client-logger';
  import { portal } from '$lib/actions/portal';

interface Props {
    isOpen: boolean;
    onclose: () => void;
    onsave: (setup: RemoteSetup) => void;
  }

  interface RemoteSetup {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    keyPath?: string;
    useAgent?: boolean;
    workspacePath: string;
    transport?: 'ssh' | 'websocket';
    wsUrl?: string;
    branch?: string;
  }

  type AuthMode = 'agent' | 'keyfile' | 'password';

  let { isOpen, onclose, onsave }: Props = $props();

  const logger = createLogger('AddRemoteSetupModal');

  // Form state
  let name = $state('');
  let transport = $state<'ssh' | 'websocket'>('ssh');
  let host = $state('');
  let port = $state(22);
  let wsUrl = $state('');
  let username = $state('');
  let password = $state('');
  let keyPath = $state('');
  let authMode = $state<AuthMode>('agent');
  let workspacePath = $state('');
  let branch = $state('main');
  let error = $state('');

  const isFormValid = $derived(
    name.trim() !== '' &&
      (transport === 'ssh'
        ? host.trim() !== '' && port > 0 && port <= 65535
        : wsUrl.trim() !== '') &&
      username.trim() !== '' &&
      workspacePath.trim() !== '',
  );

  function handleSave() {
    if (!isFormValid) {
      error = 'Please fill in all required fields';
      return;
    }

    const newSetup: RemoteSetup = {
      id: crypto.randomUUID(),
      name: name.trim(),
      host: transport === 'ssh' ? host.trim() : '',
      port: transport === 'ssh' ? port : 0,
      username: username.trim(),
      password: authMode === 'password' ? password.trim() : undefined,
      keyPath: authMode === 'keyfile' ? keyPath.trim() : undefined,
      useAgent: authMode === 'agent',
      workspacePath: workspacePath.trim(),
      transport,
      wsUrl: transport === 'websocket' ? wsUrl.trim() : undefined,
      branch: branch.trim() || undefined,
    };

    logger.info('Saving new remote setup', { name: newSetup.name, transport: newSetup.transport });
    onsave(newSetup);
    resetForm();
    onclose();
  }

  function resetForm() {
    name = '';
    transport = 'ssh';
    host = '';
    port = 22;
    wsUrl = '';
    username = '';
    password = '';
    keyPath = '';
    authMode = 'agent';
    workspacePath = '';
    branch = 'main';
    error = '';
  }

  function handleClose() {
    resetForm();
    onclose();
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-[9999] flex items-center justify-center" use:portal={'body'}>
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 bg-black/50 cursor-default"
      onclick={handleClose}
      aria-label="Close modal"
      transition:fade={{ duration: 150 }}
    ></button>

    <!-- Modal -->
    <div
      class="relative bg-sidebar border border-border shadow-xs w-full max-w-lg max-h-[90vh] overflow-y-auto px-12 py-8"
      transition:scale={scaleConfig()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <Fa icon={faServer} class="text-ghost" />
          Add Remote Setup
        </h2>
        <Button onclick={handleClose} variant="ghost" size="icon">
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="space-y-4">
        <div>
          <Label for="name">Setup Name *</Label>
          <Input
            id="name"
            bind:value={name}
            placeholder="e.g., Dev Server"
            class="mt-1"
          />
        </div>

        <!-- Connection Details -->
        <div class="space-y-3">
          <h3 class="text-sm font-medium">Connection Details</h3>

          <!-- Transport type selector -->
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors {transport === 'ssh'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'}"
              onclick={() => {
                if (transport !== 'ssh') {
                  // Reset all fields when switching to SSH
                  name = '';
                  host = '';
                  port = 22;
                  authMode = 'agent';
                  keyPath = '';
                  password = '';
                  workspacePath = '';
                  transport = 'ssh';
                }
              }}
            >
              SSH
            </button>
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors {transport === 'websocket'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'}"
              onclick={() => {
                if (transport !== 'websocket') {
                  // Reset all fields when switching to WebSocket
                  name = '';
                  wsUrl = '';
                  username = '';
                  workspacePath = '';
                  // Clear SSH auth fields since WebSocket doesn't use them
                  authMode = 'agent';
                  keyPath = '';
                  password = '';
                  transport = 'websocket';
                }
              }}
            >
              WebSocket
            </button>
          </div>

          {#if transport === 'ssh'}
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Label for="host">Host *</Label>
                <Input
                  id="host"
                  bind:value={host}
                  placeholder="dev.example.com"
                  class="mt-1"
                />
              </div>
              <div>
                <Label for="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  bind:value={port}
                  placeholder="22"
                  class="mt-1"
                />
              </div>
            </div>
          {:else}
            <div>
              <Label for="wsUrl">WebSocket URL *</Label>
              <Input
                id="wsUrl"
                bind:value={wsUrl}
                placeholder="wss://dev.example.com/ws"
                class="mt-1"
              />
            </div>
          {/if}

          <div>
            <Label for="username">Username *</Label>
            <Input
              id="username"
              bind:value={username}
              placeholder="john"
              class="mt-1"
            />
          </div>
        </div>

        <!-- Authentication (SSH only) -->
        {#if transport === 'ssh'}
          <div class="space-y-3">
            <h3 class="text-sm font-medium">Authentication</h3>

            <!-- Auth mode radio buttons -->
            <div class="space-y-2">
              <!-- SSH Agent option -->
              <label
                class="flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors {authMode === 'agent'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'}"
              >
                <input
                  type="radio"
                  name="authMode"
                  value="agent"
                  checked={authMode === 'agent'}
                  onchange={() => {
                    authMode = 'agent';
                  }}
                  class="mt-1"
                />
                <div class="flex-1">
                  <div class="flex items-center gap-2">
                    <Fa icon={faKey} class="text-ghost text-xs" />
                    <span class="text-sm font-medium">SSH Agent</span>
                  </div>
                </div>
              </label>

              <!-- Key file option -->
              <label
                class="flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors {authMode === 'keyfile'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'}"
              >
                <input
                  type="radio"
                  name="authMode"
                  value="keyfile"
                  checked={authMode === 'keyfile'}
                  onchange={() => {
                    authMode = 'keyfile';
                  }}
                  class="mt-1"
                />
                <div class="flex-1">
                  <span class="text-sm font-medium">Key File</span>
                  {#if authMode === 'keyfile'}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <!-- stopPropagation prevents clicks on interactive elements from bubbling
                         to the parent <label>, which would steal focus to the radio button -->
                    <div class="mt-1" onclick={(e) => e.stopPropagation()}>
                      <Input
                        bind:value={keyPath}
                        placeholder="~/.ssh/id_rsa"
                        class="mt-1 h-8"
                      />
                    </div>
                  {/if}
                </div>
              </label>

              <!-- Password option -->
              <label
                class="flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors {authMode === 'password'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'}"
              >
                <input
                  type="radio"
                  name="authMode"
                  value="password"
                  checked={authMode === 'password'}
                  onchange={() => {
                    authMode = 'password';
                  }}
                  class="mt-1"
                />
                <div class="flex-1">
                  <span class="text-sm font-medium">Password</span>
                  {#if authMode === 'password'}
                    <div class="mt-1">
                      <Input
                        type="password"
                        bind:value={password}
                        placeholder="••••••••"
                        class="h-8"
                      />
                    </div>
                  {/if}
                </div>
              </label>
            </div>
          </div>
        {:else}
          <!-- WebSocket info - no SSH auth needed -->
          <div class="text-sm text-subtle bg-muted/50 px-3 py-2 rounded-md">
            <p>
              WebSocket connections use the authentication configured on the remote server.
              No SSH credentials are required.
            </p>
          </div>
        {/if}

        <!-- Repository Path -->
        <div>
          <Label for="workspacePath">Repository Path *</Label>
          <Input
            id="workspacePath"
            bind:value={workspacePath}
            placeholder="/home/user/myrepo"
            class="mt-1"
          />
          <p class="text-xs text-subtle mt-1">
            Path to the git repository on the remote server
          </p>
        </div>

        <!-- Branch Name -->
        <div>
          <Label for="branch">Branch Name</Label>
          <Input
            id="branch"
            bind:value={branch}
            placeholder="main"
            class="mt-1"
          />
          <p class="text-xs text-subtle mt-1">
            Branch to check out on the remote server (defaults to main)
          </p>
        </div>

        {#if error}
          <div class="text-sm text-destructive">{error}</div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 mt-6">
        <Button onclick={handleClose} variant="outline">Cancel</Button>
        <Button onclick={handleSave} disabled={!isFormValid}>Add Setup</Button>
      </div>
    </div>
  </div>
{/if}
