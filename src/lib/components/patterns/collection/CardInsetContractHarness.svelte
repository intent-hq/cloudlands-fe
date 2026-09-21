<script lang="ts">
  import { EmptyState } from '$lib/components/patterns/screen';
  import * as Card from '$lib/components/ui/card';
  import ListRow from './ListRow.svelte';
  import ListView from './ListView.svelte';
</script>

{#snippet emptyMessage()}No archived workspaces yet.{/snippet}

<Card.Root aria-label="Workspace activity">
  <Card.Header><Card.Title>Workspace activity</Card.Title></Card.Header>
  <Card.Content flush>
    <ListView items={['Active workspace']} selectable="single">
      {#snippet row({ item })}
        <ListRow inset>{#snippet title()}{item}{/snippet}</ListRow>
      {/snippet}
    </ListView>
    <EmptyState
      inset
      density="compact"
      description={emptyMessage}
      class="justify-start border-t border-border"
      contentClass="max-w-none text-left"
    />
  </Card.Content>
</Card.Root>
