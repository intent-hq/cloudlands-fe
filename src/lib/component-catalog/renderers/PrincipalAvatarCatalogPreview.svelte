<script lang="ts">
  import { onMount, tick } from 'svelte';
  // Presentational feature components, allowlisted in catalog-shell.test.ts, which also
  // proves they stay free of runtime store/host imports.
  import NotePresenceAvatars from '$features/notes/note-presence/NotePresenceAvatars.svelte';
  import type { RemoteNoteViewer } from '$features/notes/note-presence/note-presence-service';
  import PresenceAvatarStack from '$features/presence/components/PresenceAvatarStack.svelte';
  import {
    presencePersonColor,
    presencePersonName,
    type PresenceCircle,
    type PresenceCircleAction,
  } from '$features/presence/components/presence-person';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { fixture }: CatalogRendererProps = $props();

  // A reserved TLD that never resolves, so the browser fires the image error
  // itself; jsdom never loads images, so the real error event is dispatched
  // below on every <img> under a [data-catalog-fail] wrapper. No fixture keeps
  // a loading image: capture stability waits for every <img> to load or error,
  // which jsdom never reports, so the loaded-image branch is left to the
  // characterization test.
  const FAILING_URL = 'https://avatar.invalid/missing.png';

  const people: PresenceCircle[] = [
    {
      principalId: 'ada',
      login: 'ada',
      displayName: 'Ada Lovelace',
      avatarUrl: null,
      self: true,
      online: true,
    },
    {
      principalId: 'grace',
      login: 'grace',
      displayName: 'Grace Hopper',
      avatarUrl: null,
      owner: true,
      online: true,
    },
    {
      principalId: 'linus',
      login: 'linus',
      displayName: null,
      avatarUrl: FAILING_URL,
      online: true,
    },
    {
      principalId: 'cy',
      login: 'cy',
      displayName: 'Cy Offline',
      avatarUrl: FAILING_URL,
      online: false,
    },
    {
      principalId: 'mia',
      login: 'mia',
      displayName: 'Mia Overflow',
      avatarUrl: null,
      online: true,
    },
  ];
  const noteViewers: RemoteNoteViewer[] = [
    {
      principalId: 'ada',
      login: 'ada',
      displayName: 'Ada Lovelace',
      avatarUrl: null,
      cursor: null,
      cursorSeenAt: null,
    },
    {
      principalId: 'linus',
      login: 'linus',
      displayName: null,
      avatarUrl: FAILING_URL,
      cursor: null,
      cursorSeenAt: null,
    },
    {
      principalId: 'grace',
      login: 'grace',
      displayName: 'Grace Hopper',
      avatarUrl: FAILING_URL,
      cursor: null,
      cursorSeenAt: null,
    },
    {
      principalId: 'mia',
      login: 'mia',
      displayName: 'Mia Overflow',
      avatarUrl: null,
      cursor: null,
      cursorSeenAt: null,
    },
  ];
  // The stacks own their avatar wrappers, so their failing images are found by
  // the person id they stamp on them rather than by a marker of this preview.
  const failingImageSelector = [
    '[data-catalog-fail] img',
    ...people
      .filter(({ avatarUrl }) => avatarUrl === FAILING_URL)
      .map(({ principalId }) => `[data-presence-avatar="${principalId}"] img`),
    ...noteViewers
      .filter(({ avatarUrl }) => avatarUrl === FAILING_URL)
      .map(({ principalId }) => `[data-principal-id="${principalId}"] img`),
  ].join(', ');
  const tileRows: Array<[string, string | null]> = [
    ['No URL', null],
    ['Failing URL', FAILING_URL],
  ];

  let lastSelected = $state('Nobody selected yet');
  const action = (person: PresenceCircle): PresenceCircleAction => ({
    label: `${presencePersonName(person)} · ${person.online === false ? 'offline' : 'online'}`,
    onSelect:
      person.online === false
        ? null
        : () => {
            lastSelected = `${presencePersonName(person)} selected`;
          },
  });

  let root = $state<HTMLElement>();
  // The fixture marks itself rendered only once the failing images have had
  // their real `error` event dispatched, so the contract snapshot captures the
  // fallback PrincipalAvatar itself switches to — never a stub of it.
  let failuresDriven = $state(false);
  onMount(() => {
    void tick().then(() => {
      for (const img of root?.querySelectorAll<HTMLImageElement>(failingImageSelector) ?? []) {
        img.dispatchEvent(new Event('error'));
      }
      failuresDriven = true;
    });
  });
</script>

{#snippet tile(avatarUrl: string | null, label: string, size: number)}
  <span data-catalog-fail={avatarUrl === FAILING_URL || undefined}>
    <PrincipalAvatar {avatarUrl} {label} {size} />
  </span>
{/snippet}

{#snippet filledTile(avatarUrl: string | null, label: string)}
  <span
    class="inline-flex size-8 items-center justify-center overflow-hidden rounded-full type-caption font-medium text-primary-foreground"
    style:background-color={presencePersonColor(label)}
    data-catalog-fail={avatarUrl === FAILING_URL || undefined}
  >
    <PrincipalAvatar fill {avatarUrl} {label} />
  </span>
{/snippet}

{#snippet stack(fixtureId: string)}
  {#if fixtureId === 'presence-stack-action'}
    <PresenceAvatarStack {people} maxVisible={4} size={24} {action} />
  {:else if fixtureId === 'presence-stack-decorative'}
    <PresenceAvatarStack {people} maxVisible={4} size={24} decorative />
  {:else}
    <PresenceAvatarStack {people} maxVisible={4} size={24} />
  {/if}
{/snippet}

<div
  bind:this={root}
  class="flex min-w-0 max-w-full flex-wrap items-center gap-3"
  data-catalog-renderer-fixture={failuresDriven ? fixture.id : undefined}
>
  {#if fixture.id === 'note-presence-stack'}
    <div
      class="grid min-w-0 gap-3"
      data-catalog-rendered-state={failuresDriven ? 'no-url failing-url overflow' : undefined}
    >
      <p class="type-caption text-muted-foreground">
        Other viewers of a note: one with no URL, two with a failed image, and one more person in
        the overflow chip.
      </p>
      <NotePresenceAvatars viewers={noteViewers} maxVisible={3} />
    </div>
  {:else if fixture.id === 'tile-states'}
    <div
      class="grid min-w-0 gap-4"
      data-catalog-rendered-state={failuresDriven
        ? 'no-url failing-url size-16 size-24 size-32 empty-label fill'
        : undefined}
    >
      <p class="type-caption text-muted-foreground">
        Rows: no URL, a failed image. Columns: 16, 24, and 32 px.
      </p>
      {#each tileRows as [caption, avatarUrl] (caption)}
        <div class="flex items-center gap-3">
          <span class="type-caption w-24 text-muted-foreground">{caption}</span>
          {@render tile(avatarUrl, 'Ada Lovelace', 16)}
          {@render tile(avatarUrl, 'Ada Lovelace', 24)}
          {@render tile(avatarUrl, 'Ada Lovelace', 32)}
        </div>
      {/each}
      <div class="flex items-center gap-3">
        <span class="type-caption w-24 text-muted-foreground">Empty label</span>
        {@render tile(null, '', 24)}
      </div>
      <div class="flex items-center gap-3">
        <span class="type-caption w-24 text-muted-foreground">Fill in a tile</span>
        {@render filledTile(null, 'Grace Hopper')}
        {@render filledTile(FAILING_URL, 'Grace Hopper')}
      </div>
    </div>
  {:else}
    <div
      class="grid min-w-0 gap-3"
      data-catalog-rendered-state={failuresDriven
        ? `no-url failing-url self owner member offline overflow${fixture.id === 'presence-stack-action' ? ' aria-disabled' : ''}`
        : undefined}
    >
      <p class="type-caption text-muted-foreground">
        You (no URL), the owner (no URL), a member (failed image), an offline member (failed image),
        and one more person in the overflow chip.
      </p>
      {@render stack(fixture.id)}
      {#if fixture.id === 'presence-stack-action'}
        <output class="type-caption text-muted-foreground" aria-live="polite">{lastSelected}</output
        >
      {/if}
    </div>
  {/if}
</div>
