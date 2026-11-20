<script lang="ts">
  /**
   * Set it up for me over SSH: the login. Host, port, username and how to
   * sign in (SSH agent, key file, password). The password or key passphrase
   * stays in this component until Set up, then goes straight to main
   * (`stashSshSecret`); it is never stored or put in state.
   */
  import { untrack } from 'svelte';
  import { FormField } from '$lib/components/patterns/form';
  import { Button, Input, ToggleGroup } from '$lib/components/patterns/settings/custom-controls';
  import { dialog } from '$lib/electron-bridge';
  import { m } from '$shared/paraglide/messages.js';
  import type { SshAuthMethod, SshLoginPrefill } from '$shared/types/machine-setup';
  import { store as appStore } from '$store/renderer/store';
  import { sshSetupRequested } from './machine-setup-slice';
  import { stashSshSecret } from './ssh-secret';
  import { DEFAULT_SSH_KEY_PATH, DEFAULT_SSH_PORT, validSshPort } from './ssh-login';

  interface Props {
    prefill: SshLoginPrefill | null;
    /** An SSH agent is running here (null: not known yet). */
    agentAvailable: boolean | null;
    /** The fields are complete. */
    canSubmit?: boolean;
  }

  let { prefill, agentAvailable, canSubmit = $bindable(false) }: Props = $props();

  const initial = untrack(() => prefill);
  let host = $state(initial?.host ?? '');
  let port = $state(String(initial?.port ?? DEFAULT_SSH_PORT));
  let username = $state(initial?.username ?? '');
  let method = $state<SshAuthMethod>(
    initial?.method ?? (untrack(() => agentAvailable) === false ? 'key' : 'agent'),
  );
  let keyPath = $state(initial?.keyPath ?? DEFAULT_SSH_KEY_PATH);
  let passphrase = $state('');
  let password = $state('');
  let hostInput: HTMLInputElement | null = $state(null);
  let touchedMethod = false;

  // The agent answer arrives after the screen opens: follow it until the user picks.
  $effect(() => {
    const agent = agentAvailable;
    if (initial || touchedMethod || agent === null) return;
    method = agent ? 'agent' : 'key';
  });

  $effect(() => {
    if (hostInput) requestAnimationFrame(() => hostInput?.focus());
  });

  const portNumber = $derived(Number(port.trim()));
  const portError = $derived(
    port.trim() && !validSshPort(portNumber) ? m.machineSetup_ssh_port_error() : undefined,
  );
  $effect(() => {
    canSubmit =
      host.trim().length > 0 &&
      username.trim().length > 0 &&
      validSshPort(portNumber) &&
      (method !== 'key' || keyPath.trim().length > 0) &&
      (method !== 'password' || password.length > 0);
  });

  async function browseKey() {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- a native file picker for a local key file, not a domain data fetch
    const picked = await dialog.openFile({ title: m.machineSetup_ssh_keyFile_browse_title() });
    if (picked) keyPath = picked;
  }

  /** Start the run: the fields go in the action, the secret only to main. */
  export function submit() {
    if (!canSubmit) return;
    const secret = method === 'password' ? password : method === 'key' ? passphrase : '';
    if (secret) stashSshSecret(secret);
    password = '';
    passphrase = '';
    appStore.dispatch(
      sshSetupRequested({
        host: host.trim(),
        port: portNumber,
        username: username.trim(),
        method,
        keyPath: keyPath.trim() || DEFAULT_SSH_KEY_PATH,
      }),
    );
  }
</script>

<div class="space-y-4" data-machine-setup-ssh-login>
  <div class="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
    <FormField label={m.machineSetup_ssh_host_label()} required>
      {#snippet control(props)}
        <Input
          {...props}
          bind:ref={hostInput}
          bind:value={host}
          placeholder={m.machineSetup_ssh_host_placeholder()}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
        />
      {/snippet}
    </FormField>
    <FormField label={m.machineSetup_ssh_port_label()} error={portError}>
      {#snippet control(props)}
        <Input {...props} bind:value={port} inputmode="numeric" autocomplete="off" />
      {/snippet}
    </FormField>
  </div>
  <FormField label={m.machineSetup_ssh_username_label()} required>
    {#snippet control(props)}
      <Input
        {...props}
        bind:value={username}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
      />
    {/snippet}
  </FormField>
  <div class="space-y-2">
    <p id="ssh-method-label" class="type-body text-foreground">
      {m.machineSetup_ssh_method_label()}
    </p>
    <ToggleGroup.Root
      type="single"
      value={method}
      onValueChange={(value: string) => {
        if (!value) return;
        touchedMethod = true;
        method = value as SshAuthMethod;
      }}
      size="sm"
      variant="flat"
      aria-labelledby="ssh-method-label"
    >
      <ToggleGroup.Item value="agent">{m.machineSetup_ssh_method_agent_label()}</ToggleGroup.Item>
      <ToggleGroup.Item value="key">{m.machineSetup_ssh_method_key_label()}</ToggleGroup.Item>
      <ToggleGroup.Item value="password"
        >{m.machineSetup_ssh_method_password_label()}</ToggleGroup.Item
      >
    </ToggleGroup.Root>
  </div>
  {#if method === 'agent'}
    <p class="type-caption text-muted-foreground" data-ssh-agent={agentAvailable}>
      {agentAvailable === false
        ? m.machineSetup_ssh_agentMissing_description()
        : m.machineSetup_ssh_agent_description()}
    </p>
  {:else if method === 'key'}
    <FormField label={m.machineSetup_ssh_keyFile_label()} required>
      {#snippet control(props)}
        <div class="flex gap-2">
          <Input
            {...props}
            bind:value={keyPath}
            class="min-w-0 flex-1 font-mono"
            autocomplete="off"
            spellcheck={false}
          />
          <Button type="button" variant="outline" onclick={browseKey}
            >{m.machineSetup_ssh_keyFile_browse_label()}</Button
          >
        </div>
      {/snippet}
    </FormField>
    <FormField
      label={m.machineSetup_ssh_passphrase_label()}
      description={m.machineSetup_ssh_passphrase_description()}
    >
      {#snippet control(props)}
        <Input {...props} bind:value={passphrase} type="password" autocomplete="off" />
      {/snippet}
    </FormField>
  {:else}
    <FormField label={m.machineSetup_ssh_password_label()} required>
      {#snippet control(props)}
        <Input {...props} bind:value={password} type="password" autocomplete="off" />
      {/snippet}
    </FormField>
  {/if}
</div>
