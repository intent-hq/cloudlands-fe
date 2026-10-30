<script lang="ts">
  /**
   * The sign-in progress panel shown after Create & sign in or Log In:
   * waiting (browser or Codex device code), still waiting, signed in, and the
   * Codex API-key check. Presentational: the parent owns the state.
   */
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { faCircleCheck, faCircleExclamation, faClock } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { IntentMarkLoader } from '$lib/components/patterns/settings/custom-controls';
  import type { ProfileKindProvider, ProfileSignInState } from './profile-kind-mock';

  interface Props {
    provider: ProfileKindProvider;
    state: ProfileSignInState;
    /** The plain command running in the bottom terminal. */
    command: string;
    /** Codex API-key sign-in (paste instructions while waiting). */
    apiKey?: boolean;
  }

  let { provider, state, command, apiKey = false }: Props = $props();

  type Tone = 'progress' | 'success' | 'warning' | 'danger';
  const view = $derived.by((): { tone: Tone; title: string; description?: string } | null => {
    switch (state.status) {
      case 'idle':
        return null;
      case 'waiting':
        if (state.deviceAuth) {
          return {
            tone: 'progress',
            title: m.settings_providerProfileKinds_waiting_label(),
            description: m.settings_providerProfileKinds_waitingDeviceAuth_description(),
          };
        }
        return {
          tone: 'progress',
          title: m.settings_providerProfileKinds_waiting_label(),
          description: apiKey
            ? m.settings_providerProfileKinds_waitingApiKey_description()
            : m.settings_providerProfileKinds_waitingBrowser_description(),
        };
      case 'stillWaiting':
        return {
          tone: 'warning',
          title: m.settings_providerProfileKinds_stillWaiting_label(),
          description: m.settings_providerProfileKinds_stillWaiting_description(),
        };
      case 'signedIn':
        return {
          tone: 'success',
          title:
            provider === 'claude' && state.email
              ? m.settings_providerProfileKinds_signedInAs_label({ email: state.email })
              : m.settings_providerProfileKinds_signedIn_label(),
        };
      case 'checkingKey':
        return { tone: 'progress', title: m.settings_providerProfileKinds_keyChecking_label() };
      case 'keyWorks':
        return {
          tone: 'success',
          title: m.settings_providerProfileKinds_keyWorks_label(),
          description: m.settings_providerProfileKinds_keyWorks_description(),
        };
      case 'keyRejected':
        return {
          tone: 'danger',
          title: m.settings_providerProfileKinds_keyRejected_label(),
          description: m.settings_providerProfileKinds_keyRejected_description(),
        };
    }
  });

  const icons: Record<Exclude<Tone, 'progress'>, IconDefinition> = {
    success: faCircleCheck,
    warning: faClock,
    danger: faCircleExclamation,
  };
  const iconClass: Record<Exclude<Tone, 'progress'>, string> = {
    success: 'text-success',
    warning: 'text-warning-ink',
    danger: 'text-danger',
  };
  const showCommand = $derived(state.status === 'waiting' || state.status === 'stillWaiting');
</script>

{#if view}
  <div
    class="flex items-start gap-3 rounded-md border border-border bg-card p-4"
    role={view.tone === 'danger' ? 'alert' : 'status'}
    data-testid="provider-profile-sign-in-status"
    data-status={state.status}
  >
    {#if view.tone === 'progress'}
      <IntentMarkLoader size={16} class="mt-1 shrink-0" />
    {:else}
      <Fa icon={icons[view.tone]} class="mt-1 size-4 shrink-0 {iconClass[view.tone]}" />
    {/if}
    <div class="min-w-0 space-y-1">
      <p class="type-body font-medium! text-foreground">{view.title}</p>
      {#if view.description}
        <p class="type-body text-muted-foreground">{view.description}</p>
      {/if}
      {#if showCommand}
        <p class="type-caption text-muted-foreground">
          {m.settings_providerProfileKinds_terminalCommand_label()}
          <code class="rounded bg-muted px-1.5 py-0.5 font-mono type-caption text-foreground"
            >{command}</code
          >
        </p>
      {/if}
    </div>
  </div>
{/if}
