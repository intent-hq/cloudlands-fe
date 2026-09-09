<script lang="ts">
  import { faPaperclip } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import * as Menu from '$lib/components/ui/menu';
  import * as Sheet from '$lib/components/ui/sheet';
  import { onMount } from 'svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  const uid = $props.id();
  const portalTargetId = `${uid}-portal`;
  let menuChecked = $state(false);
  let menuDensity = $state('comfortable');
  let menuOpen = $state(false);
  let dialogOpen = $state(false);
  let dialogTriggerElement = $state<HTMLButtonElement>();

  onMount(() => {
    if (componentId !== 'dialog' || fixture.id !== 'dialog-open-state') return;
    const frame = requestAnimationFrame(() => {
      dialogTriggerElement?.focus();
      dialogOpen = true;
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

{#snippet menuTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} variant="outline" size="sm" active={menuOpen}>Open catalog menu</Button>
{/snippet}

{#snippet dialogTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} variant="outline" size="sm">Open catalog dialog</Button>
{/snippet}

{#snippet openDialogTrigger({ props }: { props: Record<string, unknown> })}
  <Button bind:ref={dialogTriggerElement} {...props} variant="outline" size="sm"
    >Open-state dialog trigger</Button
  >
{/snippet}

{#snippet disabledDialogTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} variant="outline" size="sm">Open dialog with disabled close</Button>
{/snippet}

{#snippet sheetTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} variant="outline" size="sm">Open catalog sheet</Button>
{/snippet}

{#snippet disabledSheetTrigger({ props }: { props: Record<string, unknown> })}
  <Button {...props} variant="outline" size="sm">Open left sheet with disabled close</Button>
{/snippet}

<div class="flex flex-wrap gap-3" data-catalog-renderer-fixture={fixture.id}>
  <div id={portalTargetId} data-catalog-portal-target={componentId}></div>
  {#if componentId === 'menu'}
    <div data-catalog-rendered-state="closed open disabled checked radio-selected submenu-open">
      <Menu.Root bind:open={menuOpen}>
        <Menu.Trigger child={menuTrigger} />
        <Menu.Content
          portalProps={{ to: `#${portalTargetId}` }}
          preventScroll={false}
          interactOutsideBehavior="close"
        >
          <Menu.Item>Run command</Menu.Item>
          <Menu.CommandItem icon={faPaperclip} label="Attach files" shortcut="⇧⌘A" />
          <Menu.Item disabled>Disabled command</Menu.Item>
          <Menu.CheckboxItem bind:checked={menuChecked} closeOnSelect={false}
            >Show panel</Menu.CheckboxItem
          >
          <Menu.RadioGroup bind:value={menuDensity}>
            <Menu.RadioItem value="compact" closeOnSelect={false}>Compact</Menu.RadioItem>
            <Menu.RadioItem value="comfortable" closeOnSelect={false}>Comfortable</Menu.RadioItem>
          </Menu.RadioGroup>
          <Menu.Sub
            ><Menu.SubTrigger>More actions</Menu.SubTrigger><Menu.SubContent portal={false}
              ><Menu.Item>Archive</Menu.Item></Menu.SubContent
            ></Menu.Sub
          >
        </Menu.Content>
      </Menu.Root>
      <Button variant="outline" size="sm">Menu outside target</Button>
    </div>
  {:else if componentId === 'dialog'}
    {#if fixture.id === 'dialog-open-state'}
      <div data-catalog-rendered-state={fixture.states.join(' ')}>
        <Dialog.Root bind:open={dialogOpen}>
          <Dialog.Trigger child={openDialogTrigger} />
          <Dialog.Content portalProps={{ to: `#${portalTargetId}` }}>
            <Dialog.Header
              ><Dialog.Title>Catalog dialog open state</Dialog.Title><Dialog.Description
                >Deterministic open-state preview with focus restoration.</Dialog.Description
              ></Dialog.Header
            >
            <Input aria-label="Open-state dialog field" />
            <Button size="sm">Dialog nested action</Button>
          </Dialog.Content>
        </Dialog.Root>
      </div>
    {:else}
      <div data-catalog-rendered-state="closed open focused nested-content long-content">
        <Dialog.Root>
          <Dialog.Trigger child={dialogTrigger} />
          <Dialog.Content portalProps={{ to: `#${portalTargetId}` }}>
            <Dialog.Header
              ><Dialog.Title>Catalog dialog</Dialog.Title><Dialog.Description
                >Host-independent dialog preview with deliberately long content for compact layouts.</Dialog.Description
              ></Dialog.Header
            >
            <Input class="h-8" aria-label="Dialog preview field" />
            <Button size="sm">Dialog nested action</Button>
          </Dialog.Content>
        </Dialog.Root>
      </div>
      <div data-catalog-rendered-state="disabled-close">
        <Dialog.Root
          ><Dialog.Trigger child={disabledDialogTrigger} /><Dialog.Content
            portalProps={{ to: `#${portalTargetId}` }}
            closeDisabled
            ><Dialog.Title>Disabled close dialog</Dialog.Title><Dialog.Description
              >Escape and outside dismissal remain testable.</Dialog.Description
            ></Dialog.Content
          ></Dialog.Root
        >
      </div>
    {/if}
  {:else if componentId === 'sheet'}
    <div data-catalog-rendered-state="closed open right nested-content">
      <Sheet.Root>
        <Sheet.Trigger child={sheetTrigger} />
        <Sheet.Content portalProps={{ to: `#${portalTargetId}` }} side="right"
          ><Sheet.Header
            ><Sheet.Title>Catalog sheet</Sheet.Title><Sheet.Description
              >Host-independent sheet preview.</Sheet.Description
            ></Sheet.Header
          ><Input class="h-8" aria-label="Sheet preview field" /></Sheet.Content
        >
      </Sheet.Root>
    </div>
    <div data-catalog-rendered-state="left disabled-close">
      <Sheet.Root
        ><Sheet.Trigger child={disabledSheetTrigger} /><Sheet.Content
          portalProps={{ to: `#${portalTargetId}` }}
          side="left"
          closeDisabled
          ><Sheet.Title>Left sheet</Sheet.Title><Sheet.Description
            >Disabled close control state.</Sheet.Description
          ></Sheet.Content
        ></Sheet.Root
      >
    </div>
  {/if}
</div>
