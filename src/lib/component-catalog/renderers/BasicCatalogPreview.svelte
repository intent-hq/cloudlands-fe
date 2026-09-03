<script lang="ts">
  import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { ButtonGroup } from '$lib/components/ui/button-group';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Switch } from '$lib/components/ui/switch';
  import { Toggle } from '$lib/components/ui/toggle';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let checkboxChecked = $state(false);
  let switchChecked = $state(false);
  let togglePressed = $state(false);
  let groupValue = $state('list');
  let buttonClicks = $state(0);
  let buttonAction = $state('Choose an action');
  let longButtonAction = $state('Choose the long-label action');

  function recordButtonAction(action: string) {
    buttonClicks += 1;
    buttonAction = action;
  }
</script>

<div
  class="flex min-w-0 max-w-full flex-wrap items-center gap-3"
  data-catalog-renderer-fixture={fixture.id}
>
  {#if componentId === 'badge'}
    <div
      class="flex min-w-0 max-w-full flex-wrap gap-2"
      data-catalog-rendered-state="default focus long-label light dark compact"
    >
      <Badge>Default badge</Badge>
      <Badge variant="secondary">Secondary badge</Badge>
      <Badge variant="destructive">Error badge</Badge>
      <Badge href="#badge-preview">Focusable badge link</Badge>
      <Badge variant="outline" class="max-w-full truncate"
        >A deliberately long badge label for truncation review</Badge
      >
    </div>
  {:else if componentId === 'button'}
    {#if fixture.id === 'interaction-states'}
      <div
        class="flex flex-wrap items-center gap-2"
        data-catalog-rendered-state="default secondary outline destructive focus disabled loading icon-only action-feedback"
      >
        <Button onclick={() => recordButtonAction('Run action completed')}>
          <span
            class="inline-flex size-4 items-center justify-center rounded-full border border-current"
            aria-hidden="true"><Fa icon={faPlus} size="xs" /></span
          >
          Run action
        </Button>
        <Button variant="secondary" onclick={() => recordButtonAction('Secondary action completed')}
          >Secondary</Button
        >
        <Button variant="outline" onclick={() => recordButtonAction('Outline action completed')}
          >Outline</Button
        >
        <Button variant="destructive" onclick={() => recordButtonAction('Delete requested')}>
          <Fa icon={faTrash} size="xs" />
          Delete
        </Button>
        <Button disabled>Disabled action</Button>
        <Button loading>Loading action</Button>
        <Button size="icon" aria-label="Add item" onclick={() => recordButtonAction('Item added')}
          ><Fa icon={faPlus} size="xs" /></Button
        >
        <output
          class="type-caption min-w-full text-muted-foreground"
          aria-label="Button action status"
          aria-live="polite">{buttonAction}</output
        >
        <output class="sr-only" aria-label="Button click count">{buttonClicks}</output>
      </div>
    {:else}
      <div
        class="grid gap-2"
        data-catalog-rendered-state="long-label light dark compact reduced-motion action-feedback"
      >
        <Button
          class="max-w-full whitespace-normal text-left"
          variant="outline"
          onclick={() => (longButtonAction = 'Long-label action completed')}
          >A long button label that remains readable in compact layouts</Button
        >
        <output
          class="type-caption text-muted-foreground"
          aria-label="Long button action status"
          aria-live="polite">{longButtonAction}</output
        >
      </div>
    {/if}
  {:else if componentId === 'button-group'}
    <div data-catalog-rendered-state="horizontal vertical focus disabled compact">
      <ButtonGroup aria-label="Editor actions">
        <Button variant="outline">Edit</Button>
        <Button variant="outline">Preview</Button>
        <Button variant="outline" disabled>Publish</Button>
      </ButtonGroup>
    </div>
  {:else if componentId === 'checkbox'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="unchecked checked mixed disabled required-invalid"
    >
      <label class="flex items-center gap-2"
        ><Checkbox bind:checked={checkboxChecked} ariaLabel="Catalog checkbox" />Interactive</label
      >
      <label class="flex items-center gap-2"
        ><Checkbox checked ariaLabel="Checked checkbox" />Checked</label
      >
      <label class="flex items-center gap-2"
        ><Checkbox indeterminate ariaLabel="Mixed checkbox" />Mixed</label
      >
      <label class="flex items-center gap-2"
        ><Checkbox disabled ariaLabel="Disabled checkbox" />Disabled</label
      >
      <div>
        <Checkbox required ariaLabel="Required checkbox" ariaDescribedby="checkbox-error" />
        <p id="checkbox-error" class="type-caption text-error-foreground">Selection required</p>
      </div>
    </div>
  {:else if componentId === 'switch'}
    <div class="grid gap-3" data-catalog-rendered-state="off on disabled required-invalid">
      <label class="flex items-center gap-2"
        ><Switch bind:checked={switchChecked} ariaLabel="Catalog switch" />Interactive</label
      >
      <label class="flex items-center gap-2"><Switch checked ariaLabel="Enabled switch" />On</label>
      <label class="flex items-center gap-2"
        ><Switch disabled ariaLabel="Disabled switch" />Disabled</label
      >
      <div>
        <Switch required ariaLabel="Required switch" ariaDescribedby="switch-error" />
        <p id="switch-error" class="type-caption text-error-foreground">Setting required</p>
      </div>
    </div>
  {:else if componentId === 'toggle'}
    {#if fixture.id === 'toggle-state-matrix'}
      <div
        class="grid gap-3"
        data-catalog-rendered-state="unpressed pressed disabled keyboard-focus light dark compact reduced-motion"
      >
        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-3">
            <span>Interactive</span>
            <Toggle bind:pressed={togglePressed} size="xs" ariaLabel="Interactive" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Pinned</span>
            <Toggle pressed size="xs" ariaLabel="Pinned" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Compact</span>
            <Toggle size="xs" ariaLabel="Compact" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Compact pressed</span>
            <Toggle size="xs" pressed ariaLabel="Compact pressed" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Disabled</span>
            <Toggle disabled size="xs" ariaLabel="Disabled" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>Disabled pressed</span>
            <Toggle disabled pressed size="xs" ariaLabel="Disabled pressed" />
          </div>
        </div>
        <output class="sr-only" aria-label="Interactive toggle value">{togglePressed}</output>
      </div>
    {:else}
      <div class="flex flex-wrap gap-2" data-catalog-rendered-state="group">
        <Toggle
          variant="group"
          options={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
          ]}
          value="one"
          ariaLabel="Grouped toggle"
        />
      </div>
    {/if}
  {:else if componentId === 'toggle-group'}
    <div data-catalog-rendered-state="single multiple selected unselected disabled keyboard-focus">
      <ToggleGroup.Root type="single" bind:value={groupValue} aria-label="Display mode">
        <ToggleGroup.Item value="list" aria-label="List view">List</ToggleGroup.Item>
        <ToggleGroup.Item value="tree" aria-label="Tree view">Tree</ToggleGroup.Item>
        <ToggleGroup.Item value="grid" aria-label="Grid view" disabled>Grid</ToggleGroup.Item>
      </ToggleGroup.Root>
      <output class="sr-only" aria-label="Display mode value">{groupValue}</output>
    </div>
  {/if}
</div>
