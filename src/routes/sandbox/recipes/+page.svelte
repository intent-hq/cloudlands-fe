<script lang="ts">
  import { confirm, ConfirmHost } from '$lib/components/patterns/confirm';
  import { ListRow, ListView, RowActions } from '$lib/components/patterns/collection';
  import { Form, FormActions, FormField } from '$lib/components/patterns/form';
  import {
    EmptyState,
    Screen,
    ScreenBody,
    ScreenHeader,
    TakeoverScreen,
  } from '$lib/components/patterns/screen';
  import { defineSettings, SettingsForm } from '$lib/components/patterns/settings';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { faArrowUpRightFromSquare, faTrash } from '@fortawesome/free-solid-svg-icons';
  import RecipeSection from './RecipeSection.svelte';

  let compactRows = $state(true);
  let branchName = $state('feature/design-system');
  let confirmResult = $state('No decision yet');
  let selectedKeys = $state<(string | number)[]>(['guide']);
  let rowAction = $state('No row action yet');
  let takeoverStep = $state(1);
  let projectName = $state('');
  let formAttempted = $state(false);
  let formResult = $state('Not submitted');
  const projectNameError = $derived(
    formAttempted && projectName.trim().length < 3 ? 'Use at least three characters.' : undefined,
  );

  const settingsSchema = defineSettings({
    sections: [
      {
        id: 'display',
        title: 'Display',
        description: 'Schema entries own labels, descriptions, and controls.',
        entries: [
          {
            kind: 'switch',
            id: 'compact-rows',
            label: 'Compact rows',
            description: 'Reduce collection spacing.',
            get: () => compactRows,
            set: (value: boolean) => {
              compactRows = value;
            },
          },
          {
            kind: 'input',
            id: 'branch-name',
            label: 'Default branch',
            get: () => branchName,
            set: (value: string) => {
              branchName = value;
            },
          },
        ],
      },
    ],
  });
  const rows = [
    { id: 'guide', name: 'Design guide', detail: 'Decision tree and design tokens' },
    { id: 'catalog', name: 'Component catalog', detail: 'Interactive fixtures' },
    { id: 'recipes', name: 'Recipe cookbook', detail: 'Full compositions' },
  ];

  const sources = {
    settings: `<script lang="ts">\n  import { defineSettings, SettingsForm } from '$lib/components/patterns/settings';\n  const schema = defineSettings({ sections: [{ id: 'display', title: 'Display', entries }] });\n<\/script>\n<SettingsForm {schema} />`,
    confirm: `<script lang="ts">\n  import { confirm, ConfirmHost } from '$lib/components/patterns/confirm';\n  const remove = () => confirm({ title: 'Remove item?', destructive: true });\n<\/script>\n<Button onclick={remove}>Remove</Button>\n<ConfirmHost />`,
    collection: `<ListView {items} getKey={(item) => item.id} selectable="multi" bind:selectedKeys>\n  {#snippet row({ item })}\n    <ListRow>{#snippet title()}{item.name}{/snippet}{#snippet trailing()}<RowActions {actions} visibleCount={1} {overflowLabel} {onAction} />{/snippet}</ListRow>\n  {/snippet}\n</ListView>`,
    cardInset: `<script lang="ts">\n  import { ListRow, ListView } from '$lib/components/patterns/collection';\n  import { EmptyState } from '$lib/components/patterns/screen';\n  import * as Card from '$lib/components/ui/card';\n<\/script>\n<Card.Root>\n  <Card.Header><Card.Title>Workspace activity</Card.Title></Card.Header>\n  <Card.Content flush>\n    <ListView {items} getKey={(item) => item.id}>\n      {#snippet row({ item })}<ListRow inset>{#snippet title()}{item.name}{/snippet}</ListRow>{/snippet}\n    </ListView>\n    <EmptyState inset density="compact" {description} contentClass="max-w-none text-left" />\n  </Card.Content>\n</Card.Root>`,
    takeover: `<TakeoverScreen {title} {description} {primary}>\n  <p>Step content can change height without rebuilding the shell.</p>\n</TakeoverScreen>`,
    form: `<Form onSubmit={validate}>\n  <FormField label="Project name" error={nameError}>{#snippet control(props)}<Input {...props} bind:value={name} />{/snippet}</FormField>\n  <FormActions {primary} />\n</Form>`,
  };

  async function askForConfirmation() {
    const accepted = await confirm({
      title: 'Publish the design guide?',
      description: 'This demonstrates a blocking confirm flow.',
      confirmLabel: 'Publish',
    });
    confirmResult = accepted ? 'Published' : 'Cancelled';
  }

  function validateForm() {
    formAttempted = true;
    if (projectName.trim().length < 3) return;
    formResult = `Created ${projectName.trim()}`;
  }
</script>

{#snippet title()}<h3 class="type-title">Connect a workspace</h3>{/snippet}
{#snippet description()}<p>Stable screen chrome wraps a height-changing flow.</p>{/snippet}
{#snippet settingsTitle()}<h3 class="type-title">Application settings</h3>{/snippet}
{#snippet secondary()}<Button variant="outline" onclick={() => (takeoverStep = 1)}>Back</Button
  >{/snippet}
{#snippet primary()}<Button
    variant="primary"
    onclick={() => (takeoverStep = takeoverStep === 1 ? 2 : 1)}>Continue</Button
  >{/snippet}
{#snippet formPrimary()}<Button variant="primary" type="submit">Create project</Button>{/snippet}
{#snippet nestedEmptyMessage()}<span data-inset-edge="empty-state">No archived workspaces</span
  >{/snippet}
<svelte:head><title>Design system recipes</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:py-12">
  <header class="max-w-3xl space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Design system</p>
    <h1 class="type-display">Recipe cookbook</h1>
    <p class="text-muted-foreground">
      Copy these pattern-first compositions before reaching for raw primitives.
    </p>
  </header>

  <RecipeSection
    title="Schema-driven settings page"
    description="SettingsForm renders typed entries without bespoke row markup."
    source={sources.settings}
  >
    <Screen class="min-h-80 rounded-md border border-border">
      <ScreenHeader title={settingsTitle} />
      <ScreenBody class="p-5"><SettingsForm schema={settingsSchema} /></ScreenBody>
    </Screen>
  </RecipeSection>

  <RecipeSection
    title="Blocking confirm flow"
    description="One host renders queued confirm requests and restores focus."
    source={sources.confirm}
  >
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="primary" onclick={askForConfirmation}>Publish guide</Button>
      <output class="text-sm text-muted-foreground">{confirmResult}</output>
    </div>
    <ConfirmHost />
  </RecipeSection>

  <RecipeSection
    title="List with row actions"
    description="ListView owns selection and keyboard behavior; RowActions owns reveal and overflow."
    source={sources.collection}
  >
    <ListView
      items={rows}
      getKey={(item) => item.id}
      getText={(item) => item.name}
      selectable="multi"
      bind:selectedKeys
      ariaLabel="Design resources"
    >
      {#snippet row({ item })}
        <ListRow>
          {#snippet title()}{item.name}{/snippet}
          {#snippet description()}{item.detail}{/snippet}
          {#snippet trailing()}
            <RowActions
              alwaysVisible
              actions={[
                {
                  id: 'open',
                  label: `Open ${item.name}`,
                  icon: faArrowUpRightFromSquare,
                },
                {
                  id: 'remove',
                  label: `Remove ${item.name}`,
                  icon: faTrash,
                  destructive: true,
                },
              ]}
              visibleCount={1}
              overflowLabel={`More actions for ${item.name}`}
              onAction={(id) => {
                rowAction = `${id === 'open' ? 'Opened' : 'Removed'} ${item.name}`;
              }}
            />
          {/snippet}
        </ListRow>
      {/snippet}
    </ListView>
    <output class="mt-3 block text-sm text-muted-foreground">{rowAction}</output>
  </RecipeSection>

  <RecipeSection
    title="Card with nested list and empty state"
    description="Flush the card content, then apply the shared inset to each nested row and state."
    source={sources.cardInset}
  >
    <Card.Root data-inset-recipe class="max-w-xl">
      <Card.Header>
        <Card.Title><span data-inset-edge="card-title">Workspace activity</span></Card.Title>
      </Card.Header>
      <Card.Content flush>
        <ListView
          items={rows.slice(0, 2)}
          getKey={(item) => item.id}
          getText={(item) => item.name}
          ariaLabel="Active workspace resources"
        >
          {#snippet row({ item })}
            <ListRow inset>
              {#snippet title()}<span data-inset-edge="list-row">{item.name}</span>{/snippet}
              {#snippet description()}{item.detail}{/snippet}
            </ListRow>
          {/snippet}
        </ListView>
        <EmptyState
          inset
          density="compact"
          description={nestedEmptyMessage}
          class="min-h-32 justify-start border-t border-border"
          contentClass="max-w-none text-left"
        />
      </Card.Content>
    </Card.Root>
  </RecipeSection>

  <RecipeSection
    title="Takeover screen"
    description="TakeoverScreen keeps header, animated body height, and actions consistent."
    source={sources.takeover}
  >
    <div class="min-h-72 overflow-hidden rounded-md border border-border">
      <TakeoverScreen {title} {description} {secondary} {primary}>
        <div class="space-y-3">
          <p>Step {takeoverStep} of 2</p>
          {#if takeoverStep === 2}<p class="text-sm text-muted-foreground">
              The second step adds content while the shared shell animates the height.
            </p>{/if}
        </div>
      </TakeoverScreen>
    </div>
  </RecipeSection>

  <RecipeSection
    title="Form with validation"
    description="FormField wires the label, help, invalid state, and message to the input."
    source={sources.form}
  >
    <Form onSubmit={validateForm} class="max-w-xl">
      <FormField
        label="Project name"
        name="project-name"
        description="At least three characters."
        error={projectNameError}
        required
      >
        {#snippet control(field)}<Input {...field} bind:value={projectName} />{/snippet}
      </FormField>
      <FormActions primary={formPrimary} />
      <output class="text-sm text-muted-foreground">{formResult}</output>
    </Form>
  </RecipeSection>
</div>
