<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Button } from '$lib/components/ui/button';
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
  let host = $state('gitlab.com');
  let token = $state('');
  // i18n-ignore (provider brand names)
  const providerLabel = $derived(view.target.provider === 'github' ? 'GitHub' : 'GitLab');
  const busy = $derived(view.phase === 'loading');
  const pinned = $derived(view.request.pinIdentity != null);
  function connectPat() {
    const value = token;
    token = '';
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
    <div class="space-y-4">
      <p class="text-sm text-muted-foreground">{m.collaborationAuth_local_description()}</p>
      {#if view.request.hostLabel}<p>
          {m.collaborationAuth_destination_description({ host: view.request.hostLabel })}
        </p>{/if}
      {#if pinned}<p>
          {m.collaborationAuth_required_description({
            provider: providerLabel,
            host: view.target.host,
            account: view.request.pinIdentity!.externalUserId,
          })}
        </p>{/if}
      {#if !pinned}
        <div class="flex flex-wrap gap-2">
          <!-- i18n-ignore (provider brand names) -->
          <Button
            disabled={busy}
            onclick={() =>
              onAction({ type: 'choose', target: { provider: 'github', host: 'github.com' } })}
            >GitHub</Button
          >
          <div class="space-y-1">
            <Label for="collaboration-instance">{m.collaborationAuth_instance_label()}</Label><Input
              id="collaboration-instance"
              bind:value={host}
              disabled={busy}
            />
          </div>
          {#if $gitlab$}
            <!-- i18n-ignore (provider brand name) -->
            <Button
              disabled={busy}
              onclick={() =>
                onAction({
                  type: 'choose',
                  target: { provider: 'gitlab', host: host.trim().toLowerCase() },
                })}>GitLab</Button
            >
          {:else}<Button onclick={enableGitlab}>{m.collaborationAuth_enableGitlab_label()}</Button
            >{/if}
        </div>
      {/if}
      <p class="text-sm font-medium">{providerLabel} · {view.target.host}</p>
      <p class="text-sm">
        {view.target.provider === 'github'
          ? m.collaborationAuth_githubPermission_description()
          : m.collaborationAuth_gitlabPermission_description()}
      </p>
      {#if view.requestedScopes.length}<p class="text-xs">
          {m.collaborationAuth_requested_description({ scopes: view.requestedScopes.join(', ') })}
        </p>{/if}
      <p class="text-xs">
        {view.grantedScopes === null
          ? m.collaborationAuth_unknownScopes_description()
          : m.collaborationAuth_granted_description({ scopes: view.grantedScopes.join(', ') })}
      </p>
      {#if view.user}<p>
          {m.collaborationAuth_account_description({
            login: `@${view.user.login}`,
            account: view.user.id,
          })}
        </p>{/if}
      {#if view.error}<p role="alert">{collaborationErrorMessage(view.error)}</p>{/if}
      {#if view.error === 'gitlab-disabled'}
        <Button onclick={enableGitlab}>{m.collaborationAuth_enableGitlab_label()}</Button>
      {:else if view.phase === 'device' && view.device}
        <p class="font-mono select-all">{view.device.userCode}</p>
        <p class="break-all text-xs">{view.device.verificationUri}</p>
        <Button onclick={() => onAction({ type: 'open-browser' })}
          >{m.collaborationAuth_openBrowser_label()}</Button
        >
      {:else if view.error !== 'upgrade-required' && view.error !== 'local-connection-changed' && view.error !== 'request-changed'}
        <div class="flex flex-wrap gap-2">
          {#if view.user && view.phase === 'account'}<Button
              onclick={() => onAction({ type: 'confirm' })}
              >{m.collaborationAuth_confirm_label({ login: `@${view.user.login}` })}</Button
            >{/if}
          {#if view.deviceGrantSupported}<Button
              disabled={busy}
              onclick={() => onAction({ type: 'connect' })}
              >{m.collaborationAuth_signIn_label()}</Button
            >{/if}
          <Button disabled={busy} onclick={() => onAction({ type: 'refresh' })}
            >{m.collaborationAuth_retry_label()}</Button
          >
        </div>
        {#if view.target.provider === 'gitlab'}
          <div class="space-y-1">
            <Label for="collaboration-token">{m.collaborationAuth_pat_label()}</Label><Input
              id="collaboration-token"
              type="password"
              autocomplete="off"
              bind:value={token}
              disabled={busy}
            />
          </div>
          <Button disabled={busy || !token.trim()} onclick={connectPat}
            >{m.collaborationAuth_signIn_label()}</Button
          >
        {/if}
      {/if}
      <Button variant="outline" onclick={() => onAction({ type: 'cancel' })}
        >{m.workspace_modals_cancel_label()}</Button
      >
    </div>
  </ContentDialog>
{/if}
