<script lang="ts">
  /**
   * Avatar stack of the other people present somewhere (a workspace tab, an
   * agent chat): up to `maxVisible` avatars plus a "+N" overflow chip.
   * Renders nothing when nobody else is there.
   */
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { PresencePerson } from '$store/renderer/slices/presence/presence-types';
  import {
    presencePersonColor,
    presencePersonInitial,
    presencePersonName,
  } from './presence-person';

  interface Props {
    people: PresencePerson[];
    maxVisible?: number;
    /** Avatar diameter in CSS px. */
    size?: number;
    /** Tooltip placement for the per-person names. */
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** Skip the per-avatar tooltips (the parent already names the people). */
    decorative?: boolean;
    class?: string;
  }

  let {
    people,
    maxVisible = 3,
    size = 16,
    side = 'bottom',
    decorative = false,
    class: className = '',
  }: Props = $props();

  const visible = $derived(people.slice(0, maxVisible));
  const overflow = $derived(Math.max(0, people.length - maxVisible));
  const label = $derived(
    people.length === 1
      ? m.presence_avatarStack_people_one()
      : m.presence_avatarStack_people_many({ count: formatInteger(people.length) }),
  );
  const fontSize = $derived(`${Math.max(8, Math.round(size * 0.55))}px`);
</script>

{#snippet avatar(person: PresencePerson)}
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-background font-medium leading-none text-white"
    style:width="{size}px"
    style:height="{size}px"
    style:font-size={fontSize}
    style:background-color={presencePersonColor(person.principalId)}
    data-presence-avatar={person.principalId}
  >
    {#if person.avatarUrl}
      <img
        src={person.avatarUrl}
        alt=""
        aria-hidden="true"
        class="h-full w-full object-cover"
        loading="lazy"
      />
    {:else}
      {presencePersonInitial(person)}
    {/if}
  </span>
{/snippet}

{#if people.length > 0}
  <span
    class="inline-flex items-center -space-x-1 {className}"
    role="group"
    aria-label={label}
    data-presence-avatar-stack
    data-presence-count={people.length}
  >
    {#each visible as person (person.principalId)}
      {#if decorative}
        {@render avatar(person)}
      {:else}
        <Tooltip content={presencePersonName(person)} {side}>
          {@render avatar(person)}
        </Tooltip>
      {/if}
    {/each}
    {#if overflow > 0}
      <span
        class="inline-flex shrink-0 items-center justify-center rounded-full border border-background bg-muted px-1 font-medium leading-none text-muted-foreground"
        style:min-width="{size}px"
        style:height="{size}px"
        style:font-size={fontSize}
        data-presence-overflow={overflow}
        >{m.presence_avatarStack_more_label({ count: formatInteger(overflow) })}</span
      >
    {/if}
  </span>
{/if}
