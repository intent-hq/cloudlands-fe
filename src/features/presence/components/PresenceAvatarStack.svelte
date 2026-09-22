<script lang="ts">
  /**
   * Avatar stack of the people present somewhere (a workspace sidebar, an
   * agent chat): up to `maxVisible` avatars plus a "+N" overflow chip. Each
   * avatar is ringed by the person's standing when known — the owner blue, an
   * online member green, an offline member grey — an offline person's avatar
   * tile (image or coloured initials) is drawn greyscale whatever their ring,
   * and this window's own principal is marked. The ring is a box-shadow on the
   * outer element and a CSS filter greys everything its element paints, so the
   * filter lives on an inner tile and the ring keeps its colour. A person whose
   * row carries an identity (a membership row from a daemon serving the
   * identity seam) wears their forge as a small badge on the avatar; the
   * roster-only people of a chat stay unbadged. The group's accessible name
   * counts only the people present (never offline members). With `action`
   * every visible avatar is a button. Renders nothing when nobody is there.
   */
  import Fa from 'svelte-fa';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
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
  // The group label announces who is HERE: only the other people not known
  // to be offline count as present; a stack of offline members alone says so
  // instead of announcing them as here.
  const onlineOthers = $derived(
    people.filter((person) => !person.self && person.online !== false).length,
  );
  const offlineOthers = $derived(
    people.filter((person) => !person.self && person.online === false).length,
  );
  const label = $derived(
    onlineOthers === 1
      ? m.presence_avatarStack_people_one()
      : onlineOthers > 1
        ? m.presence_avatarStack_people_many({ count: formatInteger(onlineOthers) })
        : offlineOthers === 0
          ? m.presence_avatarStack_onlyYou_label()
          : offlineOthers === 1
            ? m.presence_avatarStack_offline_one()
            : m.presence_avatarStack_offline_many({ count: formatInteger(offlineOthers) }),
  );
  const fontSize = $derived(`${Math.max(8, Math.round(size * 0.55))}px`);
  /** The forge badge: about half the avatar, never below a legible glyph. */
  const badgeSize = $derived(Math.max(9, Math.round(size * 0.5)));

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
    class="relative inline-flex shrink-0 rounded-full border border-background {ring
      ? RING_CLASS[ring]
      : ''}"
    style:width="{size}px"
    style:height="{size}px"
    data-presence-avatar={person.principalId}
    data-presence-ring={ring ?? undefined}
    data-presence-offline={offline || undefined}
    data-presence-self={person.self || undefined}
  >
    <span
      class="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full font-medium leading-none text-primary-foreground {offline
        ? 'grayscale'
        : ''}"
      style:font-size={fontSize}
      style:background-color={presencePersonColor(person.principalId)}
      data-presence-avatar-tile
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
    {#if person.identity}
      <span
        class="absolute -right-0.5 -bottom-0.5 inline-flex items-center justify-center rounded-full bg-background text-foreground"
        style:width="{badgeSize}px"
        style:height="{badgeSize}px"
        style:font-size="{Math.round(badgeSize * 0.8)}px"
        aria-hidden="true"
        data-presence-identity-provider={person.identity.provider}
        data-presence-identity-host={person.identity.host}
      >
        <Fa icon={person.identity.provider === 'gitlab' ? faGitlab : faGithub} />
      </span>
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
          class="h-auto rounded-full p-0 aria-disabled:opacity-100"
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
