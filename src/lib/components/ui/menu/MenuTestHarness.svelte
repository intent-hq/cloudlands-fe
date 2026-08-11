<script lang="ts">
  import * as Menu from './index';

  let checked = $state(false);
  let density = $state('comfortable');
  let selected = $state('none');
</script>

<Menu.Root>
  <Menu.Trigger>Actions</Menu.Trigger>
  <Menu.Content portal={false}>
    <Menu.Item onSelect={() => (selected = 'apple')}>Apple</Menu.Item>
    <Menu.Item onSelect={() => (selected = 'banana')}>Banana</Menu.Item>
    <Menu.Item disabled onSelect={() => (selected = 'disabled')}>Disabled action</Menu.Item>
    <Menu.Item onSelect={() => (selected = 'cherry')}>Cherry</Menu.Item>
    <Menu.Item destructive onSelect={() => (selected = 'delete')}>Delete item</Menu.Item>
    <Menu.Separator />
    <Menu.CheckboxItem bind:checked closeOnSelect={false}>Show panel</Menu.CheckboxItem>
    <Menu.RadioGroup bind:value={density}>
      <Menu.RadioItem value="compact" closeOnSelect={false}>Compact</Menu.RadioItem>
      <Menu.RadioItem value="comfortable" closeOnSelect={false}>Comfortable</Menu.RadioItem>
    </Menu.RadioGroup>
    <Menu.Sub>
      <Menu.SubTrigger>More</Menu.SubTrigger>
      <Menu.SubContent portal={false}>
        <Menu.Item onSelect={() => (selected = 'archive')}>Archive</Menu.Item>
      </Menu.SubContent>
    </Menu.Sub>
  </Menu.Content>
</Menu.Root>

<output data-testid="selected">{selected}</output>
<output data-testid="checked">{checked}</output>
<output data-testid="density">{density}</output>
