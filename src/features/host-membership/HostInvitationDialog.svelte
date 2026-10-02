<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Select } from '$lib/components/ui/select';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { canonicalInviteHost } from '$features/workspace-sharing/utils/invite-pin';
  import { m } from '$shared/paraglide/messages.js';
  import type { HostInviteInput } from './types';

  let {
    busy = false,
    error = null,
    gitlabEnabled = false,
    createdLink = null,
    onCreate,
    onCopy,
    onClose,
  }: {
    busy?: boolean;
    error?: string | null;
    gitlabEnabled?: boolean;
    createdLink?: string | null;
    onCreate: (input: HostInviteInput) => void;
    onCopy: () => void;
    onClose: () => void;
  } = $props();
  const id = $props.id();
  let provider = $state('github');
  let account = $state('');
  let host = $state('gitlab.com');
  let consent = $state(false);
  let accountInput = $state<HTMLInputElement | null>(null);
  const pinProvider = $derived(provider === 'gitlab' ? 'gitlab' : 'github');
  const pinHost = $derived(
    canonicalInviteHost(pinProvider, provider === 'gitlab' ? host : 'github.com'),
  );
  const providers = $derived([
    { value: 'github', label: m.workspace_share_pinProvider_github_label() },
    { value: 'gitlab', label: m.workspace_share_pinProvider_gitlab_label({ host }) },
  ]);
  const invalid = $derived(
    !account.trim() || !pinHost || (provider === 'gitlab' && !gitlabEnabled),
  );
  $effect(() => {
    if (!gitlabEnabled && provider === 'gitlab') {
      provider = 'github';
      account = '';
      consent = false;
    }
  });
  function create() {
    if (busy || invalid || !consent || createdLink) return;
    onCreate({ pinLogin: account.trim(), pinProvider, pinHost: pinHost! });
  }
</script>

<ContentDialog
  open
  title={m.collaboration_host_invite_title()}
  description={m.collaboration_host_invite_description()}
  initialFocus={accountInput}
  {busy}
  dismissOnInteractOutside={false}
  {onClose}
>
  <div class="min-w-0 space-y-5">
    {#if createdLink}
      <div class="min-w-0 space-y-3 rounded border border-border bg-muted/50 p-3" role="status">
        <p class="type-body font-medium">{m.workspace_share_newLink_label()}</p>
        <code class="block break-all text-xs">{createdLink}</code>
        <Button variant="secondary" disabled={busy} onclick={onCopy}
          >{m.workspace_share_copyLink_label()}</Button
        >
      </div>
    {:else}
      {#if gitlabEnabled}
        <div class="space-y-2">
          <Label for={`${id}-provider`}>{m.collaboration_pin_provider_label()}</Label>
          <Select.Root
            bind:value={provider}
            items={providers}
            disabled={busy}
            onchange={() => {
              account = '';
              consent = false;
            }}
          >
            <Select.Trigger id={`${id}-provider`}><Select.Value /></Select.Trigger>
            <Select.Content>
              {#each providers as item}
                <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}
      {#if provider === 'gitlab'}
        <div class="space-y-2">
          <Label for={`${id}-host`}>{m.collaboration_pin_instance_label()}</Label>
          <Input
            id={`${id}-host`}
            bind:value={host}
            disabled={busy}
            oninput={() => {
              consent = false;
            }}
          />
          {#if !pinHost}<p class="type-caption text-danger" role="alert">
              {m.collaboration_pin_invalid_error()}
            </p>{/if}
        </div>
      {/if}
      <div class="space-y-2">
        <Label for={`${id}-account`}>{m.collaboration_pin_account_label()}</Label>
        <Input
          id={`${id}-account`}
          bind:ref={accountInput}
          bind:value={account}
          disabled={busy}
          oninput={() => {
            consent = false;
          }}
        />
      </div>
      <div class="space-y-3 rounded border border-border bg-muted/50 p-3">
        <p id={`${id}-permissions`} class="type-body text-muted-foreground">
          {m.collaboration_host_invite_permissions()}
        </p>
        <div class="flex items-start gap-3">
          <Checkbox
            id={`${id}-consent`}
            bind:checked={consent}
            disabled={busy || invalid}
            ariaDescribedby={`${id}-permissions`}
          />
          <Label for={`${id}-consent`} class="min-w-0 leading-normal"
            >{m.collaboration_host_invite_scope()}</Label
          >
        </div>
      </div>
    {/if}
    {#if error}<p role="alert" class="type-body text-danger">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" disabled={busy} onclick={onClose}
      >{createdLink ? m.workspace_share_close_ariaLabel() : m.settings_connections_cancel()}</Button
    >
    {#if !createdLink}
      <Button disabled={busy || invalid || !consent} onclick={create}
        >{busy ? m.workspace_share_creating_label() : m.workspace_share_createLink_label()}</Button
      >
    {/if}
  {/snippet}
</ContentDialog>
