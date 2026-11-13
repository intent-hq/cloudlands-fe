<script lang="ts" generics="Id extends string">
  /**
   * Large choice cards for the Set up a new machine wizard (its first screen
   * and the install method), in the style of Add profile's kind picker.
   * Presentational: picking a card only calls `onPick`.
   */
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/patterns/settings/custom-controls';

  interface Card {
    id: Id;
    icon: IconDefinition;
    title: string;
    description: string;
  }

  interface Props {
    cards: Card[];
    label: string;
    onPick: (id: Id) => void;
  }

  let { cards, label, onPick }: Props = $props();
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label={label}>
  {#each cards as card (card.id)}
    <Button
      type="button"
      variant="outline"
      truncateLabel={false}
      labelClass="flex items-start gap-3"
      class="h-auto justify-start gap-3 whitespace-normal p-4 text-left"
      data-machine-setup-card={card.id}
      onclick={() => onPick(card.id)}
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
