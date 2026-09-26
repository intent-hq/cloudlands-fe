<script module lang="ts">
  /**
   * PresenceAvatarStack with membership-backed rows: people whose row carries
   * an identity wear their forge as a badge (GitHub / GitLab); roster-only
   * people stay unbadged. Shown at the sidebar size and the hover-card size.
   */
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { PresenceCircle } from './presence-person';

  interface PresenceStackPreviewProps {
    people: PresenceCircle[];
    size: number;
  }

  const GITLAB_HOST = 'gitlab.example.com';

  const people: PresenceCircle[] = [
    {
      principalId: 'principal-owner',
      login: 'octocat',
      displayName: 'Octo Cat',
      avatarUrl: null,
      owner: true,
      online: true,
      self: true,
      identity: { provider: 'github', host: 'github.com', externalUserId: '583231' },
    },
    {
      principalId: 'principal-gitlab-guest',
      login: 'mara.dev',
      displayName: 'Mara Ostrowski',
      avatarUrl: null,
      online: true,
      identity: { provider: 'gitlab', host: GITLAB_HOST, externalUserId: '4021' },
    },
    {
      principalId: 'principal-github-guest',
      login: 'hubot',
      displayName: null,
      avatarUrl: null,
      online: false,
      identity: { provider: 'github', host: 'github.com', externalUserId: '480938' },
    },
    {
      principalId: 'principal-legacy-guest',
      login: 'defunkt',
      displayName: 'Chris W.',
      avatarUrl: null,
      online: true,
    },
  ];

  export const preview = definePreview<PresenceStackPreviewProps>({
    id: 'presence-avatar-stack',
    title: 'Presence avatar stack (forge badges)',
    defaultState: 'hover-card',
    states: {
      'hover-card': { props: { people, size: 32 } },
      sidebar: { props: { people, size: 18 } },
    },
  });
</script>

<script lang="ts">
  import PresenceAvatarStack from './PresenceAvatarStack.svelte';

  let { people: rows, size }: PresenceStackPreviewProps = $props();
</script>

<div class="flex items-center gap-4 p-6">
  <PresenceAvatarStack people={rows} {size} maxVisible={4} />
</div>
