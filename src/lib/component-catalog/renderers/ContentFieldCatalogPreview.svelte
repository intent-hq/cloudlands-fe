<script lang="ts">
  import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import * as Card from '$lib/components/ui/card';
  import { Spinner } from '$lib/components/ui/indicators';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { ListContainer, ListEmpty, ListItem, ListSection } from '$lib/components/ui/list';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Textarea } from '$lib/components/ui/textarea';

  type ContentFieldComponentId =
    'card' | 'list' | 'input' | 'textarea' | 'label' | 'separator' | 'skeleton' | 'spinner';

  let {
    componentId,
    fixture,
  }: { componentId: ContentFieldComponentId; fixture: UiComponentFixture } = $props();
  let inputValue = $state('');
  let textareaValue = $state('');
  const longText =
    'A deliberately long piece of editorial content that remains readable without overflowing a compact catalog viewport.';
  const spinnerVariants = ['wave', 'stair', 'snake', 'shuffle', 'pulse'] as const;
</script>

<div
  class="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden"
  data-catalog-renderer-fixture={fixture.id}
>
  {#if componentId === 'card'}
    <div
      data-catalog-rendered-state="default header metadata action footer light dark compact zoom-200 reduced-motion"
    >
      <Card.Root aria-label="Catalog editorial card">
        <Card.Header>
          <Card.Title>Workspace summary</Card.Title>
          <Card.Description>Updated moments ago</Card.Description>
          <Card.Action>Ready</Card.Action>
        </Card.Header>
        <Card.Content>Canonical raised content surface.</Card.Content>
        <Card.Footer>Three items</Card.Footer>
      </Card.Root>
    </div>
    <div data-catalog-rendered-state="long-content">
      <Card.Root><Card.Content>{longText}</Card.Content></Card.Root>
    </div>
    <div data-catalog-rendered-state="empty inert-hatch">
      <Card.Root aria-label="Empty inert card" inert><Card.Content></Card.Content></Card.Root>
    </div>
  {:else if componentId === 'list'}
    <div
      data-catalog-rendered-state="default selected active disabled loading metadata actions keyboard-focus light dark compact zoom-200 reduced-motion"
    >
      <ListContainer spacing="compact">
        <ListSection title="Recent work">
          <ListItem title="Selected item" subtitle="Supporting metadata" selected badge="3" />
          <ListItem
            title="Active item"
            active
            actions={[{ icon: faEllipsis, label: 'More actions', onClick: () => undefined }]}
            actionsVisible="always"
          />
          <ListItem title="Loading item" icon={faEllipsis} loading />
          <ListItem title="Disabled item" disabled />
        </ListSection>
      </ListContainer>
    </div>
    <div data-catalog-rendered-state="collapsed">
      <ListContainer><ListSection title="Collapsed section" collapsible collapsed /></ListContainer>
    </div>
    <div data-catalog-rendered-state="empty-message"><ListEmpty message="No catalog items" /></div>
    <div data-catalog-rendered-state="long-content">
      <ListContainer><ListItem title={longText} /></ListContainer>
    </div>
  {:else if componentId === 'input'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="default empty placeholder described keyboard-focus light dark compact-28 medium-32 large-36 zoom-200 reduced-motion"
    >
      <Label for="catalog-input">Project name</Label>
      <Input
        id="catalog-input"
        bind:value={inputValue}
        placeholder="Enter a project name"
        aria-describedby="catalog-input-help"
      />
      <p id="catalog-input-help" class="text-xs text-muted-foreground">
        A stable host-independent description.
      </p>
      <Input aria-label="Compact input" class="h-(--control-height-small)" />
      <Input aria-label="Large input" class="h-(--control-height-large)" value="Large value" />
    </div>
    <div class="grid gap-3" data-catalog-rendered-state="disabled read-only invalid">
      <Input aria-label="Disabled input" disabled value="Disabled" />
      <Input aria-label="Read-only input" readonly value="Read only" />
      <Input aria-label="Invalid input" aria-invalid="true" value="Needs review" />
    </div>
    <div data-catalog-rendered-state="file">
      <Input type="file" aria-label="Catalog file input" />
    </div>
    <div data-catalog-rendered-state="long-content">
      <Input aria-label="Long input" value={longText} />
    </div>
  {:else if componentId === 'textarea'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="default empty placeholder described auto-expand keyboard-focus light dark compact zoom-200 reduced-motion"
    >
      <Label for="catalog-textarea">Workspace summary</Label>
      <Textarea
        id="catalog-textarea"
        bind:value={textareaValue}
        placeholder="Describe this workspace"
        doesExpandToFit
        minHeight={80}
        maxHeight={120}
      />
    </div>
    <div class="grid gap-3" data-catalog-rendered-state="disabled read-only invalid">
      <Textarea aria-label="Disabled textarea" disabled value="Disabled" />
      <Textarea aria-label="Read-only textarea" readonly value="Read only" />
      <Textarea aria-label="Invalid textarea" aria-invalid="true" value="Needs review" />
    </div>
    <div data-catalog-rendered-state="max-height-scroll long-content">
      <Textarea
        aria-label="Long textarea"
        doesExpandToFit
        minHeight={80}
        maxHeight={96}
        value={`${longText} ${longText}`}
      />
    </div>
  {:else if componentId === 'label'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="default required optional long-content compact zoom-200 light dark"
    >
      <Label for="required-field">Required project name *</Label>
      <Input id="required-field" required />
      <Label for="optional-field">Optional supporting detail</Label>
      <Input id="optional-field" />
      <Label for="long-label">{longText}</Label>
      <Input id="long-label" />
    </div>
    <div class="group grid gap-2" data-disabled="true" data-catalog-rendered-state="disabled">
      <Label for="disabled-field">Disabled field</Label><Input id="disabled-field" disabled />
    </div>
  {:else if componentId === 'separator'}
    <div
      class="grid gap-4"
      data-catalog-rendered-state="horizontal decorative compact zoom-200 light dark"
    >
      <Separator decorative />
    </div>
    <div class="flex h-12 items-stretch gap-3" data-catalog-rendered-state="vertical semantic">
      <span>Before</span><Separator orientation="vertical" decorative={false} /><span>After</span>
    </div>
  {:else if componentId === 'skeleton'}
    <div
      class="grid gap-3"
      aria-label="Loading preview"
      data-catalog-rendered-state="default line card compact zoom-200 light dark reduced-motion"
    >
      <Skeleton class="h-3 w-full" />
      <Skeleton class="h-3 w-3/4" />
      <Skeleton class="h-20 w-full" />
    </div>
    <div data-catalog-rendered-state="avatar"><Skeleton class="size-8 rounded-full" /></div>
  {:else if componentId === 'spinner'}
    <div
      class="flex flex-wrap items-center gap-4"
      data-catalog-rendered-state="default wave stair snake shuffle pulse seeded-colors compact zoom-200 light dark reduced-motion"
    >
      {#each spinnerVariants as variant}
        <Spinner {variant} seed={`catalog-${variant}`} />
      {/each}
    </div>
    <div data-catalog-rendered-state="custom-size-gap">
      <Spinner seed="catalog-large" size={10} gap={4} />
    </div>
  {/if}
</div>
