<script lang="ts">
  /**
   * Step 1 of Add profile: large cards for Different login, API key (Claude
   * only), Token and Advanced. Presentational: picking a card only calls `onPick`.
   */
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { faKey, faSliders, faTicket, faUserPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import type { ProfileKindChoice, ProfileKindProvider } from './profile-kind-mock';

  interface Props {
    provider: ProfileKindProvider;
    disabled?: boolean;
    onPick: (kind: ProfileKindChoice) => void;
  }

  let { provider, disabled = false, onPick }: Props = $props();

  const cards = $derived<
    { kind: ProfileKindChoice; icon: IconDefinition; title: string; description: string }[]
  >([
    {
      kind: 'differentLogin',
      icon: faUserPlus,
      title: m.settings_providerProfileKinds_differentLogin_label(),
      description: m.settings_providerProfileKinds_differentLogin_description(),
    },
    ...(provider === 'claude'
      ? [
          {
            kind: 'apiKey' as const,
            icon: faKey,
            title: m.settings_providerProfileKinds_apiKey_label(),
            description: m.settings_providerProfileKinds_apiKeyClaude_description(),
          },
        ]
      : []),
    {
      kind: 'token',
      icon: faTicket,
      title: m.settings_providerProfileKinds_token_label(),
      description:
        provider === 'codex'
          ? m.settings_providerProfileKinds_tokenCodex_description()
          : m.settings_providerProfileKinds_tokenClaude_description(),
    },
    {
      kind: 'advanced',
      icon: faSliders,
      title: m.settings_providerProfileKinds_advanced_label(),
      description: m.settings_providerProfileKinds_advanced_description(),
    },
  ]);
</script>

<div
  class="grid grid-cols-1 gap-3 sm:grid-cols-2"
  role="group"
  aria-label={m.settings_providerProfileKinds_picker_ariaLabel()}
  data-testid="provider-profile-kind-picker"
>
  {#each cards as card (card.kind)}
    <Button
      variant="outline"
      {disabled}
      truncateLabel={false}
      labelClass="flex items-start gap-3"
      class="h-auto justify-start gap-3 whitespace-normal p-4 text-left"
      data-testid={`provider-profile-kind-${card.kind}`}
      onclick={() => onPick(card.kind)}
    >
      <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Fa icon={card.icon} class="size-4 text-foreground" />
      </span>
      <span class="flex min-w-0 flex-col gap-1">
        <span class="type-body font-medium! text-foreground">{card.title}</span>
        <span class="type-caption text-muted-foreground">{card.description}</span>
      </span>
    </Button>
  {/each}
</div>
