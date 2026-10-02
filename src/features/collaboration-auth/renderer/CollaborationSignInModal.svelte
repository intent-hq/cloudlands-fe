<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Button } from '$lib/components/ui/button';
  import * as Accordion from '$lib/components/ui/accordion';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectLabsMultiplayerEnabled,
    selectLabsGitLabEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { openPalette } from '$store/renderer/slices/palette/palette-slice';
  import type { CollaborationAction, CollaborationView } from '../types';
  import { collaborationErrorMessage } from './messages';

  let {
    view,
    static: staticPosition = false,
    onAction,
  }: {
    view: CollaborationView;
    static?: boolean;
    onAction: (action: CollaborationAction) => void;
  } = $props();
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const gitlab$ = selectLabsGitLabEnabled();
  const uid = $props.id();
  let host = $state('gitlab.com');
  let token = $state('');
  let preferToken = $state(false);
  let instanceDisclosure = $state('');
  let detailsDisclosure = $state('');
  let draftContext = $state('');
  // i18n-ignore (provider brand names)
  const providerLabel = $derived(view.target.provider === 'github' ? 'GitHub' : 'GitLab');
  const gitlab = $derived(view.target.provider === 'gitlab');
  const busy = $derived(view.phase === 'loading');
  const pinned = $derived(view.request.pinIdentity != null);
  const blocked = $derived(
    view.error === 'upgrade-required' ||
      view.error === 'local-connection-changed' ||
      view.error === 'request-changed' ||
      view.error === 'gitlab-disabled',
  );
  const showToken = $derived(
    gitlab &&
      !busy &&
      view.phase !== 'device' &&
      !blocked &&
      (preferToken ||
        view.error === 'device-grant-unsupported' ||
        (view.phase === 'account' && !view.user && !view.deviceGrantSupported)),
  );
  const confirmAccount = $derived(view.user && view.phase === 'account' && !showToken);

  $effect(() => {
    const context = JSON.stringify({
      requestId: view.requestId,
      target: view.target,
      request: view.request,
    });
    if (context === draftContext) return;
    draftContext = context;
    host = view.target.provider === 'gitlab' ? view.target.host : 'gitlab.com';
    token = '';
    preferToken = false;
    instanceDisclosure = '';
    detailsDisclosure = '';
  });

  function choose(provider: 'github' | 'gitlab', instance = 'gitlab.com') {
    token = '';
    preferToken = false;
    onAction({
      type: 'choose',
      target: { provider, host: provider === 'github' ? 'github.com' : instance },
    });
  }
  function connectPat() {
    const value = token;
    token = '';
    preferToken = false;
    onAction({ type: 'connect', token: value });
  }
  function enableGitlab() {
    onAction({ type: 'cancel' });
    appStore.dispatch(openPalette('GitLab')); // i18n-ignore (brand search)
  }
</script>

{#if $multiplayer$}
  <ContentDialog
    open
    static={staticPosition}
    title={m.collaborationAuth_title()}
    titleId="collaboration-sign-in-title"
    closeLabel={m.workspace_modals_cancel_label()}
    onClose={() => onAction({ type: 'cancel' })}
  >
    <div class="min-w-0 space-y-4">
      {#if view.request.hostLabel}
        <p class="text-sm text-muted-foreground break-words">
          {m.collaborationAuth_destination_description({ host: view.request.hostLabel })}
        </p>
      {/if}
      {#if !pinned && view.phase !== 'device' && view.error !== 'gitlab-disabled'}
        <div class="grid grid-cols-2 gap-2">
          <!-- i18n-ignore (provider brand names) -->
          <Button
            variant="outline"
            disabled={busy}
            aria-pressed={!gitlab}
            onclick={() => choose('github')}
          >
            <Fa icon={faGithub} />GitHub{#if !gitlab}<Fa icon={faCheck} size="xs" />{/if}
          </Button>
          {#if $gitlab$}
            <!-- i18n-ignore (provider brand name) -->
            <Button
              variant="outline"
              disabled={busy}
              aria-pressed={gitlab}
              onclick={() => choose('gitlab', gitlab ? view.target.host : 'gitlab.com')}
            >
              <Fa icon={faGitlab} />GitLab{#if gitlab}<Fa icon={faCheck} size="xs" />{/if}
            </Button>
          {:else}
            <Button variant="outline" disabled={busy} onclick={enableGitlab}>
              {m.collaborationAuth_enableGitlab_label()}
            </Button>
          {/if}
        </div>
      {/if}
      <div class="space-y-1">
        <p class="flex items-center gap-2 text-sm font-medium min-w-0">
          <Fa icon={gitlab ? faGitlab : faGithub} />
          <span class="min-w-0 break-words"
            >{providerLabel}{#if view.user}
              · @{view.user.login}{/if}{#if gitlab}
              · {view.target.host}{/if}</span
          >
        </p>
        {#if pinned}
          <p class="text-xs text-muted-foreground break-words">
            {m.collaborationAuth_pinned_description({
              provider: providerLabel,
              host: view.target.host,
            })}
          </p>
        {/if}
        <p class="text-sm text-muted-foreground">
          {gitlab
            ? m.collaborationAuth_gitlabConsent_description()
            : m.collaborationAuth_githubConsent_description()}
        </p>
      </div>
      {#if gitlab && !pinned && view.phase !== 'device'}
        <Accordion.Root bind:value={instanceDisclosure} disabled={busy}>
          <Accordion.Item value="instance">
            <Accordion.Header
              ><Accordion.Trigger inset={false}
                >{m.collaborationAuth_customInstance_label()}</Accordion.Trigger
              ></Accordion.Header
            >
            <Accordion.Content>
              <div class="space-y-2">
                <Label for={`${uid}-instance`}>{m.collaborationAuth_instance_label()}</Label>
                <Input
                  id={`${uid}-instance`}
                  bind:value={host}
                  disabled={busy}
                  spellcheck={false}
                  autocomplete="url"
                />
                <Button
                  variant="outline"
                  disabled={busy || !host.trim()}
                  onclick={() => choose('gitlab', host.trim().toLowerCase())}
                >
                  {m.collaborationAuth_useInstance_label()}
                </Button>
              </div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      {/if}
      {#if view.error}
        <div class="space-y-1">
          <p role="alert" class="text-sm text-danger break-words">
            {collaborationErrorMessage(view.error)}
          </p>
          {#if !blocked && (showToken || view.deviceGrantSupported)}
            <Button
              variant="link"
              class="px-0"
              disabled={busy}
              onclick={() => onAction({ type: 'refresh' })}
              >{m.collaborationAuth_retry_label()}</Button
            >
          {/if}
        </div>
      {/if}
      {#if busy}
        <div role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
          <IntentMarkLoader size={16} />{m.collaborationAuth_loading_label()}
        </div>
      {:else if view.phase === 'device' && view.device}
        <GitHubDeviceCodeCard
          userCode={view.device.userCode}
          verificationUri={view.device.verificationUri}
          openLabel={m.collaborationAuth_openBrowser_label()}
          onOpen={() => onAction({ type: 'open-browser' })}
        />
        <p role="status" class="text-sm text-muted-foreground">
          {m.lib_gitlabConnect_waitingForAuthorization_label()}
        </p>
      {:else if showToken}
        <div class="space-y-2">
          <Label for={`${uid}-token`}>{m.collaborationAuth_pat_label()}</Label>
          <Input id={`${uid}-token`} type="password" autocomplete="off" bind:value={token} />
          {#if view.deviceGrantSupported}
            <Button
              variant="link"
              class="px-0"
              onclick={() => {
                token = '';
                preferToken = false;
              }}
            >
              {m.lib_gitlabConnect_useDevice_label()}
            </Button>
          {/if}
        </div>
      {/if}
      {#if !busy && !blocked && view.phase !== 'device' && !showToken}
        <div class="flex flex-wrap gap-x-3 gap-y-1">
          {#if confirmAccount && view.deviceGrantSupported}
            <Button variant="link" class="px-0" onclick={() => onAction({ type: 'connect' })}
              >{m.collaborationAuth_changeAccount_label()}</Button
            >
          {/if}
          {#if gitlab}
            <Button
              variant="link"
              class="px-0"
              onclick={() => {
                preferToken = true;
              }}>{m.lib_gitlabConnect_useToken_label()}</Button
            >
          {/if}
        </div>
      {/if}
      <Accordion.Root bind:value={detailsDisclosure}>
        <Accordion.Item value="details">
          <Accordion.Header
            ><Accordion.Trigger inset={false}
              >{m.collaborationAuth_details_label()}</Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content>
            <div class="space-y-2 text-xs text-muted-foreground break-words">
              <p>{m.collaborationAuth_local_description()}</p>
              {#if pinned}<p>
                  {m.collaborationAuth_required_description({
                    provider: providerLabel,
                    host: view.target.host,
                    account: view.request.pinIdentity!.externalUserId,
                  })}
                </p>{/if}
              {#if view.user}<p>
                  {m.collaborationAuth_account_description({
                    login: `@${view.user.login}`,
                    account: view.user.id,
                  })}
                </p>{/if}
              {#if view.requestedScopes.length}<p>
                  {m.collaborationAuth_requested_description({
                    scopes: view.requestedScopes.join(', '),
                  })}
                </p>{/if}
              <p>
                {view.grantedScopes === null
                  ? m.collaborationAuth_unknownScopes_description()
                  : m.collaborationAuth_granted_description({
                      scopes: view.grantedScopes.join(', '),
                    })}
              </p>
            </div>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </div>
    {#snippet footer()}
      <div class="flex w-full flex-wrap justify-end gap-2">
        <Button variant="ghost" onclick={() => onAction({ type: 'cancel' })}
          >{m.workspace_modals_cancel_label()}</Button
        >
        {#if view.error === 'gitlab-disabled'}
          <Button variant="primary" onclick={enableGitlab}
            >{m.collaborationAuth_enableGitlab_label()}</Button
          >
        {:else if !busy && !blocked && view.phase !== 'device'}
          {#if showToken}
            <Button variant="primary" disabled={!token.trim()} onclick={connectPat}
              >{m.collaborationAuth_tokenSignIn_label()}</Button
            >
          {:else if confirmAccount && view.user}
            <Button variant="primary" onclick={() => onAction({ type: 'confirm' })}
              >{m.collaborationAuth_confirm_label({ login: `@${view.user.login}` })}</Button
            >
          {:else if view.deviceGrantSupported}
            <Button variant="primary" onclick={() => onAction({ type: 'connect' })}
              >{m.collaborationAuth_providerSignIn_label({ provider: providerLabel })}</Button
            >
          {:else}
            <Button variant="primary" onclick={() => onAction({ type: 'refresh' })}
              >{m.collaborationAuth_retry_label()}</Button
            >
          {/if}
        {/if}
      </div>
    {/snippet}
  </ContentDialog>
{/if}
