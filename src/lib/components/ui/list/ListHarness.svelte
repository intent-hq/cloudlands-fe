<script lang="ts">
  import { ListContainer, ListEmpty, ListItem, ListSection } from './index';

  let selected = $state('selected');
  let collapsed = $state(false);
</script>

<ListSection
  title="Recent work"
  collapsible
  {collapsed}
  onToggleCollapse={() => (collapsed = !collapsed)}
>
  <ListContainer>
    <ListItem
      title="A long list title that truncates without forcing horizontal page overflow"
      subtitle="Supporting metadata remains secondary"
      selected={selected === 'selected'}
      onclick={() => (selected = 'selected')}
    />
    <ListItem title="Active row" active badge="Live" badgeVariant="success" />
    <ListItem title="Disabled row" disabled />
  </ListContainer>
</ListSection>

<ListEmpty message="No intentionally empty items" />

<output aria-label="Selected list value">{selected}</output>
