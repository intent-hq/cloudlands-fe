<script lang="ts">
  /**
   * Avatar stack of the people present somewhere (a workspace sidebar, an
   * agent chat): up to `maxVisible` avatars plus a "+N" overflow chip. Each
   * avatar is ringed by the person's standing when known — the owner blue, an
   * online member green, an offline member grey — an offline person's avatar
   * is drawn greyscale whatever their ring, and this window's own principal
   * is marked. With `action` every visible avatar
   * is a button. Renders nothing when nobody is there.
   */
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import {
    presencePersonColor,
    presencePersonInitial,
    presencePersonLabel,
    presencePersonRing,
    type PresenceCircle,
    type PresenceCircleAction,
    type PresenceRing,
  } from './presence-person';

  interface Props {
    people: PresenceCircle[];
    maxVisible?: number;
    /** Avatar diameter in CSS px. */
    size?: number;
    /** Tooltip placement for the per-person names. */
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** Skip the per-avatar tooltips (the parent already names the people). */
    decorative?: boolean;
    /** Make each visible avatar a button labelled and driven by this resolver. */
    action?: (person: PresenceCircle) => PresenceCircleAction;
    class?: string;
  }

  let {
    people,
    maxVisible = 3,
    size = 16,
    side = 'bottom',
    decorative = false,
    action,
    class: className = '',
  }: Props = $props();

  const visible = $derived(people.slice(0, maxVisible));
  const overflow = $derived(Math.max(0, people.length - maxVisible));
  const others = $derived(people.filter((person) => !person.self).length);
  const label = $derived(
    others === 0
      ? m.presence_avatarStack_onlyYou_label()
      : others === 1
        ? m.presence_avatarStack_people_one()
        : m.presence_avatarStack_people_many({ count: formatInteger(others) }),
  );
  const fontSize = $derived(`${Math.max(8, Math.round(size * 0.55))}px`);

  const RING_CLASS: Record<PresenceRing, string> = {
    owner: 'ring-2 ring-info',
    member: 'ring-2 ring-success',
    offline: 'ring-2 ring-muted-foreground/40',
  };
</script>

{#snippet avatar(person: PresenceCircle)}
  {@const ring = presencePersonRing(person)}
  {@const offline = person.online === false}
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-background font-medium leading-none text-primary-foreground {ring
      ? RING_CLASS[ring]
      : ''} {offline ? 'grayscale' : ''}"
    style:width="{size}px"
    style:height="{size}px"
    style:font-size={fontSize}
    style:background-color={presencePersonColor(person.principalId)}
    data-presence-avatar={person.principalId}
    data-presence-ring={ring ?? undefined}
    data-presence-offline={offline || undefined}
    data-presence-self={person.self || undefined}
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
      {#if action}
        {@const { label: personLabel, onSelect } = action(person)}
        <Button
          variant="plain"
          wrapContent={false}
          class="h-auto rounded-full p-0"
          tooltip={personLabel}
          tooltipSide={side}
          aria-label={personLabel}
          aria-disabled={onSelect ? undefined : true}
          onclick={onSelect ?? undefined}
          data-presence-person-button={person.principalId}
        >
          {@render avatar(person)}
        </Button>
      {:else if decorative}
        {@render avatar(person)}
      {:else}
        <Tooltip content={presencePersonLabel(person)} {side}>
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
