<script lang="ts">
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { PresencePerson } from '$store/renderer/slices/presence/presence-types';
  import type { WorkspaceInvite } from '$features/workspace-sharing/types';
  import { presencePersonName, presencePersonNameWithForge } from './presence-person';

  let { people, invites }: { people: PresencePerson[]; invites: WorkspaceInvite[] } = $props();
  const rows = $derived([
    ...people.map((person) => ({
      key: `member:${person.principalId}`,
      name: presencePersonNameWithForge(person),
      avatarLabel: presencePersonName(person),
      avatarUrl: person.avatarUrl,
      inactive: !person.viewing,
      status: person.viewing
        ? m.presence_status_viewing()
        : person.online
          ? m.workspace_peopleRoster_inactive_label()
          : m.presence_status_offline(),
      self: person.self,
    })),
    ...invites.map((invite) => ({
      key: `invite:${invite.id}`,
      name:
        invite.pinIdentity?.provider === 'gitlab'
          ? m.presence_person_gitlabHandle_label({
              login: `@${invite.pinLogin}`,
              host: invite.pinIdentity.host,
            })
          : invite.pinIdentity?.provider === 'github' || invite.pinGithubUserId !== undefined
            ? m.presence_person_githubHandle_label({ login: `@${invite.pinLogin}` })
            : `@${invite.pinLogin}`,
      avatarLabel: invite.pinLogin ?? '',
      avatarUrl: null,
      inactive: true,
      status: m.workspace_share_invited_label(),
      self: false,
    })),
  ]);
</script>

{#if rows.length > 0}
  <section data-people-roster aria-label={m.workspace_peopleTile_title()}>
    <h3 class="px-2.5 py-1.5 type-caption text-muted-foreground">
      {m.workspace_peopleTile_title()}
    </h3>
    <ListView
      items={rows}
      getKey={(row) => row.key}
      getText={(row) => row.name}
      ariaLabel={m.workspace_peopleTile_title()}
      virtualize={false}
      class="overflow-visible"
    >
      {#snippet row({ item })}
        <ListRow class="min-h-9 gap-2.5 px-2.5 py-1.5" data-people-roster-id={item.key}>
          {#snippet leading()}
            <PrincipalAvatar
              avatarUrl={item.avatarUrl}
              label={item.avatarLabel}
              size={24}
              class={item.inactive ? 'grayscale' : ''}
            />
          {/snippet}
          {#snippet title()}
            <span
              class={item.inactive ? 'text-muted-foreground' : 'text-foreground'}
              title={item.name}
            >
              {item.self ? m.presence_person_you_label({ name: item.name }) : item.name}
            </span>
          {/snippet}
          {#snippet description()}{item.status}{/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  </section>
{/if}
