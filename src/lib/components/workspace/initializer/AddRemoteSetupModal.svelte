<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { InputMessage } from '$lib/components/ui/input-message';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    isOpen: boolean;
    portalTarget?: string | HTMLElement;
    inline?: boolean;
    initialSetup?: Partial<
      Pick<
        RemoteSetup,
        'name' | 'host' | 'port' | 'wsUrl' | 'username' | 'workspacePath' | 'branch'
      >
    >;
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

  let { isOpen, onclose, onsave, inline = false, initialSetup }: Props = $props();

  const logger = createLogger('AddRemoteSetupModal');

  // Form state
  // svelte-ignore state_referenced_locally - initial form values
  let name = $state(initialSetup?.name ?? '');
  let transport = $state<'ssh' | 'websocket'>('ssh');
  // svelte-ignore state_referenced_locally - initial form values
  let host = $state(initialSetup?.host ?? '');
  // svelte-ignore state_referenced_locally - initial form values
  let port = $state(initialSetup?.port ?? 22);
  // svelte-ignore state_referenced_locally - initial form values
  let wsUrl = $state(initialSetup?.wsUrl ?? '');
  // svelte-ignore state_referenced_locally - initial form values
  let username = $state(initialSetup?.username ?? '');
  let password = $state('');
  let keyPath = $state('');
  let authMode = $state<AuthMode>('agent');
  // svelte-ignore state_referenced_locally - initial form values
  let workspacePath = $state(initialSetup?.workspacePath ?? '');
  // svelte-ignore state_referenced_locally - initial form values
  let branch = $state(initialSetup?.branch ?? 'main');
  let error = $state('');

  const isFormValid = $derived(
    name.trim() !== '' &&
      (transport === 'ssh'
        ? host.trim() !== '' && port > 0 && port <= 65535
        : wsUrl.trim() !== '') &&
      username.trim() !== '' &&
      workspacePath.trim() !== '' &&
      (authMode === 'agent' ||
        (authMode === 'keyfile' && keyPath.trim() !== '') ||
        (authMode === 'password' && password.trim() !== '')),
  );

  function handleSave() {
    if (!isFormValid) {
      error = m.workspace_addRemoteSetupModal_requiredFields_error();
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
  <FormDialog
    open={isOpen}
    static={inline}
    title={m.workspace_addRemoteSetupModal_title()}
    closeLabel={m.workspace_addRemoteSetupModal_close_ariaLabel()}
    submitLabel={m.workspace_addRemoteSetupModal_addSetup_label()}
    cancelLabel={m.workspace_addRemoteSetupModal_cancel_label()}
    size="lg"
    canSubmit={isFormValid}
    onSubmit={handleSave}
    onCancel={handleClose}
  >
    <!-- Content -->
    <div class="space-y-4">
      <div>
        <Label for="name">{m.workspace_addRemoteSetupModal_setupName_label()}</Label>
        <Input
          id="name"
          bind:value={name}
          placeholder={m.workspace_addRemoteSetupModal_setupName_placeholder()}
          class="mt-1"
        />
      </div>

      <!-- Connection Details -->
      <div class="space-y-3">
        <h3 class="text-sm font-medium">
          {m.workspace_addRemoteSetupModal_connectionDetails_label()}
        </h3>

        <!-- Transport type selector -->
        <div class="flex gap-2">
          <Button
            variant="ghost"
            type="button"
            class="flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors {transport ===
            'ssh'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:bg-muted'}"
            onclick={() => {
              if (transport !== 'ssh') {
                resetForm();
                transport = 'ssh';
              }
            }}
          >
            <!-- i18n-ignore (protocol name) -->
            SSH
          </Button>
          <Button
            variant="ghost"
            type="button"
            class="flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors {transport ===
            'websocket'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:bg-muted'}"
            onclick={() => {
              if (transport !== 'websocket') {
                resetForm();
                transport = 'websocket';
              }
            }}
          >
            <!-- i18n-ignore (protocol name) -->
            WebSocket
          </Button>
        </div>

        {#if transport === 'ssh'}
          <div class="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
            <div>
              <Label for="host">{m.workspace_addRemoteSetupModal_host_label()}</Label>
              <!-- i18n-ignore (example hostname placeholder) -->
              <Input id="host" bind:value={host} placeholder="dev.example.com" class="mt-1" />
            </div>
            <div>
              <Label for="port">{m.workspace_addRemoteSetupModal_port_label()}</Label>
              <Input id="port" type="number" bind:value={port} placeholder="22" class="mt-1" />
            </div>
          </div>
        {:else}
          <div>
            <Label for="wsUrl">{m.workspace_addRemoteSetupModal_wsUrl_label()}</Label>
            <Input
              id="wsUrl"
              bind:value={wsUrl}
              placeholder={/* i18n-ignore (example URL placeholder) */ 'wss://dev.example.com/ws'}
              class="mt-1"
            />
          </div>
        {/if}

        <div>
          <Label for="username">{m.workspace_addRemoteSetupModal_username_label()}</Label>
          <!-- i18n-ignore (example username placeholder) -->
          <Input id="username" bind:value={username} placeholder="john" class="mt-1" />
        </div>
      </div>

      <!-- Authentication (SSH only) -->
      {#if transport === 'ssh'}
        <div class="space-y-3">
          <h3 class="text-sm font-medium">
            {m.workspace_addRemoteSetupModal_authentication_label()}
          </h3>

          <ToggleGroup.Root
            type="single"
            bind:value={
              () => authMode,
              (value) => {
                if (value === 'agent' || value === 'keyfile' || value === 'password')
                  authMode = value;
              }
            }
            aria-label={m.workspace_addRemoteSetupModal_authentication_label()}
            variant="outline"
            class="flex w-full"
          >
            <ToggleGroup.Item
              value="agent"
              class="min-w-0 flex-1"
              onclick={(event) => {
                if (authMode === 'agent') event.preventDefault();
              }}
              onkeydown={(event) => {
                if (authMode === 'agent' && ['Enter', ' '].includes(event.key))
                  event.preventDefault();
              }}>{m.workspace_addRemoteSetupModal_sshAgent_label()}</ToggleGroup.Item
            >
            <ToggleGroup.Item
              value="keyfile"
              class="min-w-0 flex-1"
              onclick={(event) => {
                if (authMode === 'keyfile') event.preventDefault();
              }}
              onkeydown={(event) => {
                if (authMode === 'keyfile' && ['Enter', ' '].includes(event.key))
                  event.preventDefault();
              }}>{m.workspace_addRemoteSetupModal_keyFile_label()}</ToggleGroup.Item
            >
            <ToggleGroup.Item
              value="password"
              class="min-w-0 flex-1"
              onclick={(event) => {
                if (authMode === 'password') event.preventDefault();
              }}
              onkeydown={(event) => {
                if (authMode === 'password' && ['Enter', ' '].includes(event.key))
                  event.preventDefault();
              }}>{m.workspace_addRemoteSetupModal_password_label()}</ToggleGroup.Item
            >
          </ToggleGroup.Root>
          {#if authMode === 'keyfile'}
            {@const keyPathExample = '~/.ssh/id_rsa'}
            <Input
              bind:value={keyPath}
              placeholder={keyPathExample}
              aria-label={m.workspace_addRemoteSetupModal_keyFile_label()}
            />
          {/if}
          {#if authMode === 'password'}
            <Input
              type="password"
              bind:value={password}
              placeholder="••••••••"
              aria-label={m.workspace_addRemoteSetupModal_password_label()}
            />
          {/if}
        </div>
      {:else}
        <!-- WebSocket info - no SSH auth needed -->
        <div class="type-caption text-subtle">
          <p>
            {m.workspace_addRemoteSetupModal_websocketAuth_description()}
          </p>
        </div>
      {/if}

      <!-- Repository Path -->
      <div>
        <Label for="workspacePath">{m.workspace_addRemoteSetupModal_repoPath_label()}</Label>
        <Input
          id="workspacePath"
          bind:value={workspacePath}
          placeholder={/* i18n-ignore (example path placeholder) */ '/home/user/myrepo'}
          class="mt-1"
        />
      </div>

      <!-- Branch Name -->
      <div>
        <Label for="branch">{m.workspace_addRemoteSetupModal_branch_label()}</Label>
        <!-- i18n-ignore (branch name placeholder) -->
        <Input id="branch" bind:value={branch} placeholder="main" class="mt-1" />
      </div>

      {#if error}
        <InputMessage tone="error">{error}</InputMessage>
      {/if}
    </div>
  </FormDialog>
{/if}
