<script lang="ts">
  /**
   * ForgeIdentityChoice — Settings → Connections: which connected forge is
   * this host's identity for shared workspaces (the daemon's
   * `identity.provider` setting). With both GitHub and GitLab connected the
   * user picks one; the pick is confirmation-gated because the daemon re-keys
   * its primary principal (invites already pinned to the old identity keep
   * working, new invites use the new one). With one forge connected the
   * choice is hidden and the row states which identity is in use.
   */
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import { faUser } from '@fortawesome/free-solid-svg-icons';
  import { ToggleGroup } from '$lib/components/patterns/settings/custom-controls';
  import { confirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import type { IdentityProvider } from '$features/workspace-sharing/types';
  import {
    initializeIdentity,
    setIdentityProviderRequested,
  } from '$store/renderer/slices/identity/identity-slice';
  import {
    selectEffectiveIdentityProvider,
    selectIdentityError,
    selectIdentityProviderChoosable,
    selectIdentitySaving,
  } from '$store/renderer/slices/identity/identity-selectors';
  import { selectGitHubAuthUser } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import {
    selectGitLabAuthHost,
    selectGitLabAuthUser,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';

  const effective$ = selectEffectiveIdentityProvider();
  const choosable$ = selectIdentityProviderChoosable();
  const saving$ = selectIdentitySaving();
  const error$ = selectIdentityError();
  const githubUser$ = selectGitHubAuthUser();
  const gitlabUser$ = selectGitLabAuthUser();
  const gitlabHost$ = selectGitLabAuthHost();

  onMount(() => {
    appStore.dispatch(initializeIdentity());
  });

  function providerName(provider: IdentityProvider): string {
    return provider === 'gitlab'
      ? m.settings_connections_identity_gitlab_label({ host: $gitlabHost$ })
      : m.settings_connections_identity_github_label();
  }

  function providerLogin(provider: IdentityProvider): string | null {
    const login = provider === 'gitlab' ? $gitlabUser$?.login : $githubUser$?.login;
    return login ? `@${login}` : null;
  }

  /** "GitHub @octocat" — the identity as the daemon will present it. */
  function identityLabel(provider: IdentityProvider): string {
    const login = providerLogin(provider);
    return login
      ? m.settings_connections_identity_current_label({ provider: providerName(provider), login })
      : providerName(provider);
  }

  const githubOptionLabel = $derived(identityLabel('github'));
  const gitlabOptionLabel = $derived(identityLabel('gitlab'));

  async function handleChoice(value: string) {
    if (value !== 'github' && value !== 'gitlab') return;
    if (value === $effective$ || $saving$) return;
    const confirmed = await confirm({
      title: m.settings_connections_identity_switch_title({ identity: identityLabel(value) }),
      description: m.settings_connections_identity_switch_description(),
      confirmLabel: m.settings_connections_identity_switch_confirm_label(),
    });
    if (!confirmed) return;
    appStore.dispatch(setIdentityProviderRequested(value));
  }
</script>

{#if $effective$}
  <div class="py-3" data-testid="forge-identity">
    <div class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
      <div class="flex size-4 items-center justify-center text-ghost">
        <Fa icon={faUser} class="size-4" />
      </div>
      <div class="flex min-w-0 items-center gap-3">
        <span class="type-body font-medium text-foreground"
          >{m.settings_connections_identity_title()}</span
        >
        <span
          class="type-body flex min-w-0 items-center gap-1 text-muted-foreground"
          data-testid="forge-identity-current"
          data-provider={$effective$}
        >
          <Fa icon={$effective$ === 'gitlab' ? faGitlab : faGithub} class="size-3" />
          {identityLabel($effective$)}
        </span>
      </div>
      <p class="type-body col-start-2 text-muted-foreground">
        {#if $choosable$}
          {m.settings_connections_identity_choose_description()}
        {:else}
          {m.settings_connections_identity_single_description({
            provider: providerName($effective$),
          })}
        {/if}
      </p>
      {#if $choosable$}
        <div class="col-start-2">
          <ToggleGroup.Root
            type="single"
            value={$effective$}
            onValueChange={(value: string) => void handleChoice(value)}
            disabled={$saving$}
            aria-label={m.settings_connections_identity_title()}
            variant="flat"
            class="inline-flex flex-wrap gap-2 bg-transparent p-0"
          >
            <ToggleGroup.Item
              value="github"
              class="h-auto gap-2 px-3 py-1.5"
              data-testid="forge-identity-option-github"
            >
              <Fa icon={faGithub} class="size-3" />
              <span class="truncate">{githubOptionLabel}</span>
            </ToggleGroup.Item>
            <ToggleGroup.Item
              value="gitlab"
              class="h-auto gap-2 px-3 py-1.5"
              data-testid="forge-identity-option-gitlab"
            >
              <Fa icon={faGitlab} class="size-3" />
              <span class="truncate">{gitlabOptionLabel}</span>
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
      {/if}
      {#if $error$}
        <p class="type-body col-start-2 text-danger">{$error$}</p>
      {/if}
    </div>
  </div>
{/if}
