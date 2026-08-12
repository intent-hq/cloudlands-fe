<script lang="ts">
  import { faPaperclip } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import * as Menu from './index';
  import type { StackedMenuGroup } from './index';

  let { stacked = false }: { stacked?: boolean } = $props();

  let checked = $state(false);
  let density = $state('comfortable');
  let selected = $state('none');

  const stackedGroups: StackedMenuGroup[] = [
    {
      id: 'account',
      // i18n-ignore (test fixture)
      label: 'My Account',
      items: [
        {
          id: 'profile',
          label: 'Profile',
          shortcut: '⇧⌘P',
          onSelect: () => (selected = 'profile'),
        },
        { id: 'billing', label: 'Billing', disabled: true, onSelect: () => (selected = 'billing') },
      ],
    },
    {
      id: 'team',
      label: 'Team',
      items: [
        {
          id: 'invite',
          // i18n-ignore (test fixture)
          label: 'Invite users',
          items: [
            {
              id: 'email',
              label: 'Email',
              icon: faPaperclip,
              onSelect: () => (selected = 'email'),
            },
            { id: 'message', label: 'Message', onSelect: () => (selected = 'message') },
          ],
        },
      ],
    },
  ];
</script>

<Menu.Root>
  <Menu.Trigger>{stacked ? 'Open stacked menu' : 'Actions'}</Menu.Trigger>
  {#if stacked}
    <Menu.StackedContent groups={stackedGroups} portal={false} submenuClass="w-44" />
  {:else}
    <Menu.Content portal={false}>
      <Menu.Item onSelect={() => (selected = 'apple')}>Apple</Menu.Item>
      <Menu.Item onSelect={() => (selected = 'banana')}>Banana</Menu.Item>
      <Menu.Item disabled onSelect={() => (selected = 'disabled')}>Disabled action</Menu.Item>
      <Menu.Item onSelect={() => (selected = 'cherry')}>Cherry</Menu.Item>
      <Menu.Item destructive onSelect={() => (selected = 'delete')}>Delete item</Menu.Item>
      <Menu.CommandItem
        icon={faPaperclip}
        label={m.chat_richInput_attachFiles_label()}
        shortcut="⇧⌘A"
        onSelect={() => (selected = 'attach')}
      />
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
  {/if}
</Menu.Root>

<output data-testid="selected">{selected}</output>
<output data-testid="checked">{checked}</output>
<output data-testid="density">{density}</output>
