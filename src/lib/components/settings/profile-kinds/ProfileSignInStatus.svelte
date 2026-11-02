<script lang="ts">
  /**
   * The key check panel shown after an API key / Token save: checking, "Key
   * works" or "Key was rejected". Presentational: the parent owns the state.
   */
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { faCircleCheck, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { IntentMarkLoader } from '$lib/components/patterns/settings/custom-controls';
  import type { ProfileSignInState } from './profile-kind-mock';

  interface Props {
    state: ProfileSignInState;
  }

  let { state }: Props = $props();

  type Tone = 'progress' | 'success' | 'danger';
  const view = $derived.by((): { tone: Tone; title: string; description?: string } | null => {
    switch (state.status) {
      case 'idle':
        return null;
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
    danger: faCircleExclamation,
  };
  const iconClass: Record<Exclude<Tone, 'progress'>, string> = {
    success: 'text-success',
    danger: 'text-danger',
  };
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
    </div>
  </div>
{/if}
