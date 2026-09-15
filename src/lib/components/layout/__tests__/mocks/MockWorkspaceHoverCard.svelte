<script lang="ts">
  let { workspace = null, activeAgentIds = [], onRemoveMember }: any = $props();

  /** Stands in for the card's collaborator rows: one Remove per listed member. */
  const removable = [
    {
      principalId: 'p-2',
      login: 'user2',
      displayName: null,
      avatarUrl: null,
      owner: false,
      online: true,
      viewing: false,
      self: false,
    },
  ];
</script>

<div data-workspace-hover-card>
  <div data-workspace-hover-card-title>{workspace?.title}</div>
  <div data-workspace-hover-card-status>{workspace?.statusMessage}</div>
  <div data-workspace-hover-card-progress></div>
  <div data-workspace-hover-card-agents>{activeAgentIds.join(',')}</div>
  {#if onRemoveMember}
    {#each removable as person (person.principalId)}
      <button
        type="button"
        data-workspace-hover-card-person-remove={person.principalId}
        onclick={() => onRemoveMember(person)}>Remove</button
      >
    {/each}
  {/if}
</div>
