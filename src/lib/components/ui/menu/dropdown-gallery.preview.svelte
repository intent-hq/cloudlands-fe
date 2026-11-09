<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    section?: 'all' | 'menus' | 'pickers' | 'states';
  }

  export const preview = definePreview<Props>({
    id: 'dropdown-gallery',
    title: 'Dropdown gallery',
    defaultState: 'default',
    states: {
      default: { props: { section: 'all' } },
      menus: { props: { section: 'menus' } },
      pickers: { props: { section: 'pickers' } },
      states: { props: { section: 'states' } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Combobox } from '$lib/components/ui/combobox';
  import { Select } from '$lib/components/ui/select';
  import * as Menu from '$lib/components/ui/menu';
  import { faCopy, faPen, faTrash, faBoxArchive, faThumbtack } from '$lib/icons/phosphor-icons';
  import ConversationMenu from './dropdown-polish.preview.svelte';

  let { section: initialSection = 'all' }: Props = $props();
  let section = $state(untrack(() => initialSection));
  let pinned = $state(true);
  let notifications = $state(true);
  let font = $state('sans');
  let selected = $state('');
  let errorInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    const input = errorInput;
    if (!input) return;
    untrack(() => {
      input.value = 'example';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'menus', label: 'Menus & submenus' },
    { id: 'pickers', label: 'Pickers' },
    { id: 'states', label: 'States' },
  ] as const;
  const options = [
    { value: 'ada', label: 'Ada Lovelace' },
    { value: 'grace', label: 'Grace Hopper' },
    { value: 'linus', label: 'Linus Torvalds', disabled: true },
  ];
  const groups = [
    { key: 'active', label: 'Active', options: options.slice(0, 2) },
    { key: 'unavailable', label: 'Unavailable', options: options.slice(2) },
  ];
  const appMenus = [
    {
      id: 'panel-header-actions',
      state: 'agent',
      label: 'Conversation, note, file, browser & terminal',
    },
    { id: 'browser-tabs-menu', state: 'five-tabs', label: 'Browser tabs' },
    { id: 'sidebar-pr-dropdown', state: 'live', label: 'Pull requests' },
    { id: 'primary-client-menu', state: 'elsewhere', label: 'Primary computer' },
    { id: 'files-open-menu', state: 'normal', label: 'Open files & external apps' },
    { id: 'initializer-pickers', state: 'top', label: 'Workspace setup pickers' },
    { id: 'repository-forge-picker', state: 'github-only', label: 'Repository & forge' },
    { id: 'initial-agent-picker', state: 'populated', label: 'Agent picker' },
    { id: 'menu-search', state: 'picker', label: 'Menu search' },
  ];
  const includes = (group: Props['section']) => section === 'all' || section === group;
</script>

<!-- i18n-ignore (design-system review gallery copy) -->
<section class="grid gap-6" data-testid="dropdown-gallery">
  <nav class="flex flex-wrap gap-1" aria-label="Dropdown families">
    {#each filters as filter (filter.id)}
      <Button
        variant="ghost"
        size="sm"
        active={section === filter.id}
        aria-pressed={section === filter.id}
        onclick={() => (section = filter.id)}>{filter.label}</Button
      >
    {/each}
  </nav>

  <div class="dropdown-grid">
    {#if includes('menus')}
      <article>
        <h2>Conversation</h2>
        <ConversationMenu />
      </article>

      <article>
        <h2>Font submenu</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full">
            <Menu.RadioGroup bind:value={font} aria-label="Font">
              <Menu.RadioItem value="sans">Sans-serif</Menu.RadioItem>
              <Menu.RadioItem value="monospace">Mono</Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Content></Menu.Root
        >
        <h2 class="mt-3">Tasks submenu</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full">
            <Menu.CommandItem
              label="Review the dropdown styles"
              onSelect={() => (selected = 'Review task')}
            />
            <Menu.CommandItem
              label="Check keyboard navigation"
              onSelect={() => (selected = 'Keyboard task')}
            />
          </Menu.Content></Menu.Root
        >
        <h2 class="mt-3">Prompts submenu</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full">
            <Menu.CommandItem label="Latest prompt" onSelect={() => (selected = 'Latest prompt')} />
            <Menu.CommandItem label="First prompt" onSelect={() => (selected = 'First prompt')} />
          </Menu.Content></Menu.Root
        >
      </article>

      <article>
        <h2>Action & context menus</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full">
            <Menu.Group>
              <Menu.Label alignIconColumn={false}>Workspace</Menu.Label>
              <Menu.CommandItem
                icon={faPen}
                label="Rename"
                onSelect={() => (selected = 'Rename workspace')}
              />
              <Menu.CommandItem
                icon={faCopy}
                label="Copy link"
                shortcut="⌘C"
                onSelect={() => (selected = 'Copy link')}
              />
              <Menu.CheckboxItem indicator="switch" icon={faThumbtack} bind:checked={pinned}
                >Pin workspace</Menu.CheckboxItem
              >
              <Menu.CommandItem
                label="Share workspace"
                disabledReason="Connect an account to share"
              />
            </Menu.Group>
            <Menu.Separator />
            <Menu.CommandItem
              icon={faBoxArchive}
              label="Archive workspace"
              onSelect={() => (selected = 'Archive workspace')}
            />
            <Menu.CommandItem
              icon={faTrash}
              label="Delete workspace…"
              destructive
              onSelect={() => (selected = 'Delete workspace')}
            />
          </Menu.Content></Menu.Root
        >
        <h2 class="mt-3">Iconless menu</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full">
            <Menu.CommandItem label="Open in new panel" />
            <Menu.CommandItem label="Close panel" />
          </Menu.Content></Menu.Root
        >
      </article>
    {/if}

    {#if includes('pickers')}
      <article>
        <h2>Single selection</h2>
        <Select.Root value="grace" open items={options} staticPosition>
          <Select.Trigger aria-label="Single selection"><Select.Value /></Select.Trigger>
          <Select.Content
            >{#each options as option (option.value)}<Select.Item {...option}
                >{option.label}</Select.Item
              >{/each}</Select.Content
          >
        </Select.Root>
      </article>
      <article>
        <h2>Searchable picker</h2>
        <Combobox
          value="grace"
          open
          {options}
          ariaLabel="Searchable picker"
          inputVariant="search"
          staticPosition
          portal={false}
        />
      </article>
      <article>
        <h2>Multiple selection</h2>
        <Combobox
          value={['ada', 'grace']}
          multiple
          open
          {options}
          ariaLabel="Multiple selection"
          inputVariant="search"
          staticPosition
          portal={false}
        />
      </article>
      <article>
        <h2>Grouped picker</h2>
        <Combobox
          value="grace"
          open
          {groups}
          ariaLabel="Grouped picker"
          inputVariant="search"
          staticPosition
          portal={false}
        />
      </article>
    {/if}

    {#if includes('states')}
      <article>
        <h2>Switches, mixed & disabled</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full">
            <Menu.CheckboxItem indicator="switch" bind:checked={notifications}
              >Notifications</Menu.CheckboxItem
            >
            <Menu.CheckboxItem indicator="switch" checked={false}>Desktop control</Menu.CheckboxItem
            >
            <Menu.CheckboxItem indicator="switch" checked disabled
              >Disabled setting</Menu.CheckboxItem
            >
            <Menu.CheckboxItem indeterminate>Some items selected</Menu.CheckboxItem>
            <Menu.CommandItem label="Unavailable command" disabled />
          </Menu.Content></Menu.Root
        >
      </article>
      <article>
        <h2>Empty results</h2>
        <Combobox
          open
          options={[]}
          ariaLabel="Empty results"
          inputVariant="search"
          staticPosition
          portal={false}
        />
      </article>
      <article>
        <h2>Loading</h2>
        <Combobox
          open
          loading
          options={[]}
          ariaLabel="Loading results"
          inputVariant="search"
          staticPosition
          portal={false}
        />
      </article>
      <article>
        <h2>Error & retry</h2>
        <Combobox
          open
          options={[]}
          onsearch={() => Promise.reject(new Error('Preview search unavailable'))}
          bind:inputRef={errorInput}
          ariaLabel="Unavailable results"
          inputVariant="search"
          staticPosition
          portal={false}
        />
      </article>
      <article>
        <h2>Long & scrolling</h2>
        <Menu.Root open staticPosition
          ><Menu.Content class="w-full" maxHeight="14rem">
            {#each Array.from({ length: 20 }, (_, index) => index + 1) as index (index)}<Menu.CommandItem
                label={`Conversation ${index} with a longer title`}
              />{/each}
          </Menu.Content></Menu.Root
        >
      </article>
    {/if}
  </div>

  <section class="grid gap-2">
    <h2>Real app menus</h2>
    <div class="flex flex-wrap gap-x-4 gap-y-2">
      {#each appMenus as menu (menu.id)}<a
          class="type-caption text-muted-foreground underline-offset-4 hover:underline"
          href={`/sandbox/${menu.id}?state=${menu.state}`}>{menu.label}</a
        >{/each}
      <a
        class="type-caption text-muted-foreground underline-offset-4 hover:underline"
        href="/sandbox/popovers">Existing dropdown adapters</a
      >
    </div>
  </section>
  {#if selected}<p role="status" class="type-caption text-muted-foreground">{selected}</p>{/if}
</section>

<style>
  .dropdown-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
    align-items: start;
    gap: var(--space-5);
  }
  article {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: var(--space-2);
  }
  h2 {
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    font-weight: var(--text-caption-weight);
    color: hsl(var(--muted-foreground));
  }
</style>
