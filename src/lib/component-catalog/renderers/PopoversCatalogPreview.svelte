<script lang="ts">
  import { faPaperclip } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Combobox } from '$lib/components/ui/combobox';
  import { Dropdown, type DropdownOption } from '$lib/components/ui/dropdown';
  import { GroupedCombobox, type OptionGroup } from '$lib/components/ui/grouped-combobox';
  import { Input } from '$lib/components/ui/input';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import * as Menu from '$lib/components/ui/menu';
  import * as Popover from '$lib/components/ui/popover';
  import { SearchableSelect } from '$lib/components/ui/searchable-select';
  import { Select } from '$lib/components/ui/select';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import { preview as workspacePreview } from '$lib/components/workspace/workspace-hover-card.preview.svelte';
  import GitHubLinkCardPreview, {
    preview as githubPreview,
  } from '$lib/components/ui/tooltip/github-link-card.preview.svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { fixture }: CatalogRendererProps = $props();
  const options = [
    { value: 'ada', label: 'Ada Lovelace' },
    { value: 'grace', label: 'Grace Hopper' },
    { value: 'linus', label: 'Linus Torvalds', disabled: true },
  ];
  const groups: OptionGroup[] = [
    { key: 'active', label: 'Active', options: options.slice(0, 2) },
    { key: 'unavailable', label: 'Unavailable', options: options.slice(2) },
  ];
  const dropdownOptions: DropdownOption[] = [
    { value: 'open', label: 'Open workspace', icon: faPaperclip, shortcut: '⌘O' },
    { value: 'pin', label: 'Pin workspace', type: 'toggle', checked: true },
    { value: 'separator', label: '', type: 'separator' },
    { value: 'disabled', label: 'Unavailable action', disabled: true },
    { value: 'more', label: 'More actions', type: 'submenu', children: [] },
  ];
  const longItems = Array.from({ length: 16 }, (_, index) => `Command ${index + 1}`);
  const workspaceCard = workspacePreview.states.working.props.cards[0];
  const githubProps = githubPreview.states['pr-open'].props;
</script>

<div class="matrix" data-catalog-renderer-fixture={fixture.id} data-popovers-matrix>
  <article
    class="matrix-cell"
    data-catalog-rendered-state="default hover active disabled checked radio shortcut icon submenu destructive separator group-label"
  >
    <h3 class="type-caption font-medium text-muted-foreground">Menu item states</h3>
    <Menu.Root open staticPosition>
      <Menu.Content class="w-full">
        <Menu.Group>
          <Menu.GroupHeading class="type-caption px-2 py-1.5 font-medium text-muted-foreground"
            >Workspace actions</Menu.GroupHeading
          >
          <Menu.Item>Default item</Menu.Item>
          <Menu.Item data-highlighted>Hover / highlighted</Menu.Item>
          <Menu.Item data-state="open">Active / pressed</Menu.Item>
          <Menu.Item disabled>Disabled item</Menu.Item>
          <Menu.CheckboxItem checked>Checked checkbox</Menu.CheckboxItem>
          <Menu.RadioGroup value="comfortable">
            <Menu.RadioItem value="compact">Compact radio</Menu.RadioItem>
            <Menu.RadioItem value="comfortable">Comfortable radio</Menu.RadioItem>
          </Menu.RadioGroup>
          <Menu.CommandItem icon={faPaperclip} label="Attach files" shortcut="⇧⌘A" />
          <Menu.Sub><Menu.SubTrigger>More actions</Menu.SubTrigger></Menu.Sub>
          <Menu.Item destructive>Delete workspace</Menu.Item>
          <Menu.Separator />
          <Menu.Item>After separator</Menu.Item>
        </Menu.Group>
      </Menu.Content>
    </Menu.Root>
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="long-menu scrolling">
    <h3 class="type-caption font-medium text-muted-foreground">Long menu</h3>
    <Menu.Root open staticPosition>
      <Menu.Content class="w-full" maxHeight="12rem">
        {#each longItems as item}<Menu.Item>{item}</Menu.Item>{/each}
      </Menu.Content>
    </Menu.Root>
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="compact-density">
    <h3 class="type-caption font-medium text-muted-foreground">Compact menu</h3>
    <SizeProvider size="compact">
      <Menu.Root open staticPosition>
        <Menu.Content class="w-full"
          ><Menu.Item>Compact action</Menu.Item><Menu.Item>Second action</Menu.Item></Menu.Content
        >
      </Menu.Root>
    </SizeProvider>
  </article>

  <article
    class="matrix-cell"
    data-catalog-rendered-state="dropdown-menu open selected disabled submenu"
  >
    <h3 class="type-caption font-medium text-muted-foreground">Dropdown menu</h3>
    <Dropdown
      value="open"
      open
      options={dropdownOptions}
      searchable={false}
      portal={false}
      staticPosition
    />
  </article>

  <article
    class="matrix-cell"
    data-catalog-rendered-state="select default highlighted selected disabled-option"
  >
    <h3 class="type-caption font-medium text-muted-foreground">Select listbox</h3>
    <Select.Root value="grace" open items={options} staticPosition>
      <Select.Trigger aria-label="Catalog static select"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each options as option}<Select.Item
            value={option.value}
            label={option.label}
            disabled={option.disabled}>{option.label}</Select.Item
          >{/each}
      </Select.Content>
    </Select.Root>
  </article>

  <article
    class="matrix-cell"
    data-catalog-rendered-state="combobox default highlighted selected disabled-option"
  >
    <h3 class="type-caption font-medium text-muted-foreground">Combobox listbox</h3>
    <Combobox
      value="grace"
      open
      {options}
      ariaLabel="Catalog static combobox"
      staticPosition
      portal={false}
    />
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="empty-search searchable-select">
    <h3 class="type-caption font-medium text-muted-foreground">Empty search</h3>
    <SearchableSelect open staticPosition options={[]} placeholder="Search people" />
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="grouped grouped-combobox">
    <h3 class="type-caption font-medium text-muted-foreground">Grouped combobox</h3>
    <GroupedCombobox value="grace" open staticPosition {groups} defaultCollapsed={false} />
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="popover title body">
    <h3 class="type-caption font-medium text-muted-foreground">Popover — title and body</h3>
    <Popover.Root open staticPosition
      ><Popover.Content class="w-full p-4"
        ><h4 class="type-title font-medium">Workspace details</h4>
        <p class="type-body mt-1 text-muted-foreground">
          Review the selected workspace before continuing.
        </p></Popover.Content
      ></Popover.Root
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="popover form">
    <h3 class="type-caption font-medium text-muted-foreground">Popover — form</h3>
    <Popover.Root open staticPosition
      ><Popover.Content class="grid w-full gap-3 p-4"
        ><label class="type-caption" for="popover-name">Workspace name</label><Input
          id="popover-name"
          value="Design system"
        /><Button size="sm">Save</Button></Popover.Content
      ></Popover.Root
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="popover footer">
    <h3 class="type-caption font-medium text-muted-foreground">Popover — footer</h3>
    <Popover.Root open staticPosition
      ><Popover.Content class="w-full"
        ><div class="p-4">
          <h4 class="type-title font-medium">Archive workspace?</h4>
          <p class="type-body mt-1 text-muted-foreground">You can restore it later.</p>
        </div>
        <footer class="flex justify-end gap-2 border-t border-border p-3">
          <Button variant="ghost" size="sm">Cancel</Button><Button size="sm">Archive</Button>
        </footer></Popover.Content
      ></Popover.Root
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="hover-card workspace">
    <h3 class="type-caption font-medium text-muted-foreground">Workspace hover card</h3>
    <HoverCard anchor="--catalog-workspace" staticPosition class="w-full"
      ><WorkspaceHoverCard
        workspace={workspaceCard.workspace}
        isLoading={workspaceCard.isLoading}
        lineStats={workspaceCard.lineStats}
        activeAgentIds={workspaceCard.activeAgentIds ?? []}
        loadAgentSessions={false}
        loadWorkspaceData={false}
        staticData
      /></HoverCard
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="hover-card github-link">
    <h3 class="type-caption font-medium text-muted-foreground">GitHub link card</h3>
    <HoverCard anchor="--catalog-github" staticPosition class="w-full"
      ><GitHubLinkCardPreview {...githubProps} /></HoverCard
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="tooltip short">
    <h3 class="type-caption font-medium text-muted-foreground">Tooltip — short</h3>
    <Tooltip.Provider delayDuration={0}
      ><Tooltip.Root open staticPosition
        ><Tooltip.Content>Open settings</Tooltip.Content></Tooltip.Root
      ></Tooltip.Provider
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="tooltip multi-line">
    <h3 class="type-caption font-medium text-muted-foreground">Tooltip — multi-line</h3>
    <Tooltip.Provider delayDuration={0}
      ><Tooltip.Root open staticPosition
        ><Tooltip.Content class="max-w-56"
          >This action updates every selected workspace and cannot be undone.</Tooltip.Content
        ></Tooltip.Root
      ></Tooltip.Provider
    >
  </article>

  <article class="matrix-cell" data-catalog-rendered-state="tooltip kbd zoom-200 reduced-motion">
    <h3 class="type-caption font-medium text-muted-foreground">Tooltip — keyboard shortcut</h3>
    <Tooltip.Provider delayDuration={0}
      ><Tooltip.Root open staticPosition
        ><Tooltip.Content
          ><span class="flex items-center gap-2"
            >Open command menu <ShortcutChip>⌘K</ShortcutChip></span
          ></Tooltip.Content
        ></Tooltip.Root
      ></Tooltip.Provider
    >
  </article>
</div>

<style>
  .matrix {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: var(--catalog-row-gap);
    width: 100%;
  }
  .matrix-cell {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: var(--space-2);
    padding: var(--catalog-preview-padding);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
  }
</style>
