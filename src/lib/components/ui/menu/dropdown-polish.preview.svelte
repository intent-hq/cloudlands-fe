<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    state?: 'default' | 'interactive' | 'long-content' | 'iconless' | 'disabled-settings';
    harnessVersion?: string;
  }

  export const preview = definePreview<Props>({
    id: 'dropdown-polish',
    title: 'Dropdown polish',
    defaultState: 'default',
    states: {
      default: { props: { state: 'default' } },
      interactive: { props: { state: 'interactive' } },
      'long-content': { props: { state: 'long-content' } },
      iconless: { props: { state: 'iconless' } },
      'disabled-settings': { props: { state: 'disabled-settings' } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import {
    faBell,
    faBoxArchive,
    faListCheck,
    faCopy,
    faDesktop,
    faEllipsis,
    faFont,
    faMessage,
    faPen,
    faRightLeft,
    faTrash,
  } from '$lib/icons/phosphor-icons';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';

  let { state: scenario = 'default', harnessVersion = '3.8' }: Props = $props();
  let open = $state(untrack(() => scenario !== 'interactive'));
  let notifications = $state(true);
  let desktop = $state(false);
  let font = $state('sans');
  let selected = $state('');
  const icons = $derived(scenario !== 'iconless');
</script>

{#snippet desktopIcon()}<Fa icon={faDesktop} size={16} class="text-muted-foreground" />{/snippet}
{#snippet notificationsIcon()}<Fa icon={faBell} size={16} class="text-muted-foreground" />{/snippet}

<!-- i18n-ignore (design-system preview fixture copy) -->
<section class="grid w-60 max-w-full gap-2" data-testid="dropdown-polish">
  <Menu.Root bind:open staticPosition={scenario !== 'interactive'}>
    {#if scenario === 'interactive'}
      <Menu.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" class="justify-between" aria-label="Conversation menu">
            Conversation <Fa icon={faEllipsis} size={16} />
          </Button>
        {/snippet}
      </Menu.Trigger>
    {/if}
    <Menu.Content class="w-60 max-w-full" aria-label="Conversation actions">
      <Menu.Group>
        <Menu.Label alignIconColumn={false}>Conversation</Menu.Label>
        <Menu.CommandItem
          icon={icons ? faPen : undefined}
          label="Rename"
          onSelect={() => (selected = 'Rename')}
        />
        <Menu.CommandItem
          icon={icons ? faCopy : undefined}
          label="Copy conversation"
          onSelect={() => (selected = 'Copy conversation')}
        />
        <Menu.Sub>
          <Menu.SubTrigger icon={icons ? faListCheck : undefined}
            ><span class="min-w-0 flex-1">Tasks</span></Menu.SubTrigger
          >
          <Menu.SubContent staticPosition={false}>
            <Menu.CommandItem
              label="Review the dropdown styles"
              onSelect={() => (selected = 'Review task')}
            />
            <Menu.CommandItem
              label="Check keyboard navigation"
              onSelect={() => (selected = 'Keyboard task')}
            />
          </Menu.SubContent>
        </Menu.Sub>
        <Menu.Sub>
          <Menu.SubTrigger icon={icons ? faMessage : undefined}
            ><span class="min-w-0 flex-1">Prompts</span></Menu.SubTrigger
          >
          <Menu.SubContent staticPosition={false}>
            <Menu.CommandItem label="Latest prompt" onSelect={() => (selected = 'Latest prompt')} />
            <Menu.CommandItem label="First prompt" onSelect={() => (selected = 'First prompt')} />
          </Menu.SubContent>
        </Menu.Sub>
      </Menu.Group>
      <Menu.Separator />
      <Menu.Group>
        <Menu.Label alignIconColumn={false}>Settings</Menu.Label>
        <Menu.Sub>
          <Menu.SubTrigger icon={icons ? faFont : undefined}>
            <span class="min-w-0 flex-1">Font</span>
            <span class="text-muted-foreground">{font === 'sans' ? 'Sans-serif' : 'Monospace'}</span
            >
          </Menu.SubTrigger>
          <Menu.SubContent staticPosition={false}>
            <Menu.RadioGroup bind:value={font} aria-label="Font">
              <Menu.RadioItem value="sans">Sans-serif</Menu.RadioItem>
              <Menu.RadioItem value="monospace">Monospace</Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.SubContent>
        </Menu.Sub>
        <Menu.CheckboxItem
          bind:checked={desktop}
          indicator="switch"
          leading={icons ? desktopIcon : undefined}
          disabled={scenario === 'disabled-settings'}
        >
          <span class="min-w-0 flex-1">Desktop control</span>
        </Menu.CheckboxItem>
        <Menu.CheckboxItem
          bind:checked={notifications}
          indicator="switch"
          leading={icons ? notificationsIcon : undefined}
          disabled={scenario === 'disabled-settings'}
        >
          <span class="min-w-0 flex-1">Notifications</span>
        </Menu.CheckboxItem>
      </Menu.Group>
      <Menu.Separator />
      <Menu.Group>
        <Menu.Label alignIconColumn={false}>Agent</Menu.Label>
        <Menu.CommandItem
          icon={icons ? faRightLeft : undefined}
          label="Replace agent…"
          disabledReason={scenario === 'long-content'
            ? 'This agent is busy. Wait for the current response to finish.'
            : undefined}
          onSelect={() => (selected = 'Replace agent')}
        />
        <Menu.CommandItem
          icon={icons ? faBoxArchive : undefined}
          label="Retire agent"
          onSelect={() => (selected = 'Retire agent')}
        />
        <Menu.CommandItem
          icon={icons ? faTrash : undefined}
          label="Delete agent…"
          destructive
          onSelect={() => (selected = 'Delete agent')}
        />
      </Menu.Group>
      {#if scenario === 'long-content'}
        <Menu.Separator />
        <Menu.Group>
          <Menu.Label alignIconColumn={false}>More commands</Menu.Label>
          {#each Array.from({ length: 20 }, (_, index) => index + 1) as index (index)}
            <Menu.CommandItem
              label={`Review conversation ${index} with a deliberately long descriptive title`}
              onSelect={() => (selected = `Conversation ${index}`)}
            />
          {/each}
        </Menu.Group>
      {/if}
      <Menu.Footer>Lead specialist · Harness v{harnessVersion}</Menu.Footer>
    </Menu.Content>
  </Menu.Root>
  <p role="status" class="type-caption text-muted-foreground">{selected}</p>
</section>
