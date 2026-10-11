// Source: src/routes/sandbox/recipes/+page.svelte.
// i18n-ignore (source-preserving internal design system recipe content)
import { useState } from 'react';
import { ArrowSquareOutIcon, TrashIcon } from '@phosphor-icons/react';
import { confirm, ConfirmHost } from '@/components/patterns/confirm';
import { ListRow, ListView } from '@/components/patterns/collection';
import { Form, FormActions, FormField } from '@/components/patterns/form';
import {
  EmptyState,
  Screen,
  ScreenBody,
  ScreenHeader,
  TakeoverScreen,
} from '@/components/patterns/screen';
import { defineSettings, SettingsForm } from '@/components/patterns/settings';
import { Button } from '@/components/ui/button';
import * as Card from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ListItem } from '@/components/ui/list';
import { RecipeSection } from './recipe-section';

const rows = [
  { id: 'guide', name: 'Design guide', detail: 'Decision tree and design tokens' },
  { id: 'catalog', name: 'Component catalog', detail: 'Interactive fixtures' },
  { id: 'recipes', name: 'Recipe cookbook', detail: 'Full compositions' },
];

// Copyable React equivalents of the source page's concise composition examples.
const sources = {
  settings: `import { defineSettings, SettingsForm } from '@/components/patterns/settings';
const schema = defineSettings({ sections: [{ id: 'display', title: 'Display', entries }] });
<SettingsForm schema={schema} />`,
  confirm: `import { confirm, ConfirmHost } from '@/components/patterns/confirm';
const remove = () => confirm({ title: 'Remove item?', destructive: true });
<Button onClick={remove}>Remove</Button>
<ConfirmHost />`,
  collection: `<ListView items={items} getKey={(item) => item.id}
  row={({ item }) => (
    <ListItem title={item.name} selected={selectedKeys.includes(item.id)} onClick={() => toggle(item.id)} actions={actions(item)} />
  )}
/>`,
  cardInset: `import { ListRow, ListView } from '@/components/patterns/collection';
import { EmptyState } from '@/components/patterns/screen';
import * as Card from '@/components/ui/card';
<Card.Root>
  <Card.Header><Card.Title>Workspace activity</Card.Title></Card.Header>
  <Card.Content className="py-0 first:pt-0">
    <ListView items={items} getKey={(item) => item.id} className="rounded-md [--radius-row:var(--radius-md)]"
      row={({ item }) => <ListRow className="rounded-md px-0" title={item.name} />}
    />
    <EmptyState density="compact" description={description} className="min-h-0 px-0 py-4" contentClass="max-w-none text-left" />
  </Card.Content>
</Card.Root>`,
  takeover: `<TakeoverScreen title={title} description={description} primary={primary}>
  <p>Step content can change height without rebuilding the shell.</p>
</TakeoverScreen>`,
  form: `<Form onSubmit={validate}>
  <FormField label="Project name" error={nameError} control={(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />} />
  <FormActions primary={primary} />
</Form>`,
};

export function RecipesPage() {
  const [compactRows, setCompactRows] = useState(true);
  const [branchName, setBranchName] = useState('feature/design-system');
  const [confirmResult, setConfirmResult] = useState('No decision yet');
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>(['guide']);
  const [rowAction, setRowAction] = useState('No row action yet');
  const [takeoverStep, setTakeoverStep] = useState(1);
  const [projectName, setProjectName] = useState('');
  const [formAttempted, setFormAttempted] = useState(false);
  const [formResult, setFormResult] = useState('Not submitted');
  const projectNameError =
    formAttempted && projectName.trim().length < 3 ? 'Use at least three characters.' : undefined;

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
            set: setCompactRows,
          },
          {
            kind: 'input',
            id: 'branch-name',
            label: 'Default branch',
            get: () => branchName,
            set: setBranchName,
          },
        ],
      },
    ],
  });

  async function askForConfirmation() {
    const accepted = await confirm({
      title: 'Publish the design guide?',
      description: 'This demonstrates a blocking confirm flow.',
      confirmLabel: 'Publish',
    });
    setConfirmResult(accepted ? 'Published' : 'Cancelled');
  }

  function validateForm() {
    setFormAttempted(true);
    if (projectName.trim().length < 3) return;
    setFormResult(`Created ${projectName.trim()}`);
  }

  function toggleResource(id: string) {
    setSelectedKeys((keys) =>
      keys.includes(id) ? keys.filter((key) => key !== id) : [...keys, id],
    );
  }

  function recordRowAction(action: 'open' | 'remove', name: string) {
    setRowAction(`${action === 'open' ? 'Opened' : 'Removed'} ${name}`);
  }

  return (
    <>
      <title>Design system recipes</title>
      <div className="w-full min-w-0 space-y-8 px-4 py-8 sm:px-6 lg:py-12">
        <header className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Design system</p>
          <h1 className="type-display">Recipe cookbook</h1>
          <p className="max-w-3xl text-muted-foreground">
            Copy these pattern-first compositions before reaching for raw primitives.
          </p>
        </header>

        <RecipeSection
          title="Schema-driven settings page"
          description="SettingsForm renders typed entries without bespoke row markup."
          source={sources.settings}
        >
          <Screen className="min-h-80 rounded-md border border-border">
            <ScreenHeader title={<h3 className="type-title">Application settings</h3>} />
            <ScreenBody className="p-5">
              <SettingsForm schema={settingsSchema} />
            </ScreenBody>
          </Screen>
        </RecipeSection>

        <RecipeSection
          title="Blocking confirm flow"
          description="One host renders queued confirm requests and restores focus."
          source={sources.confirm}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={askForConfirmation}>
              Publish guide
            </Button>
            <output className="text-sm text-muted-foreground">{confirmResult}</output>
          </div>
          <ConfirmHost />
        </RecipeSection>

        <RecipeSection
          title="List with row actions"
          description="ListView owns collection structure; ListItem keeps primary and secondary controls as siblings."
          source={sources.collection}
        >
          <ListView
            items={rows}
            getKey={(item) => item.id}
            getText={(item) => item.name}
            ariaLabel="Design resources"
            row={({ item }) => (
              <ListItem
                title={item.name}
                subtitle={item.detail}
                selected={selectedKeys.includes(item.id)}
                onClick={() => toggleResource(item.id)}
                actionsVisible="always"
                actions={[
                  {
                    label: `Open ${item.name}`,
                    icon: ArrowSquareOutIcon,
                    onClick: () => recordRowAction('open', item.name),
                  },
                  {
                    label: `Remove ${item.name}`,
                    icon: TrashIcon,
                    onClick: () => recordRowAction('remove', item.name),
                  },
                ]}
              />
            )}
          />
          <output className="mt-3 block text-sm text-muted-foreground">{rowAction}</output>
        </RecipeSection>

        <RecipeSection
          title="Card with nested list and empty state"
          description="Keep the list inside the card content inset, with matching rounded rows and symmetric empty-state padding."
          source={sources.cardInset}
        >
          <Card.Root data-inset-recipe className="max-w-xl">
            <Card.Header>
              <Card.Title>
                <span data-inset-edge="card-title">Workspace activity</span>
              </Card.Title>
            </Card.Header>
            <Card.Content className="py-0 first:pt-0">
              <ListView
                items={rows.slice(0, 2)}
                getKey={(item) => item.id}
                getText={(item) => item.name}
                ariaLabel="Active workspace resources"
                className="rounded-md [--radius-row:var(--radius-md)]"
                row={({ item }) => (
                  <ListRow
                    className="rounded-md px-0"
                    title={<span data-inset-edge="list-row">{item.name}</span>}
                    description={item.detail}
                  />
                )}
              />
              <EmptyState
                density="compact"
                description={<span data-inset-edge="empty-state">No archived workspaces</span>}
                className="min-h-0 px-0 py-4"
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
          <div className="min-h-72 overflow-hidden rounded-md border border-border">
            <TakeoverScreen
              title={<h3 className="type-title">Connect a workspace</h3>}
              description={<p>Stable screen chrome wraps a height-changing flow.</p>}
              secondary={
                <Button variant="outline" onClick={() => setTakeoverStep(1)}>
                  Back
                </Button>
              }
              primary={
                <Button
                  variant="primary"
                  onClick={() => setTakeoverStep((step) => (step === 1 ? 2 : 1))}
                >
                  Continue
                </Button>
              }
            >
              <div className="space-y-3">
                <p>Step {takeoverStep} of 2</p>
                {takeoverStep === 2 && (
                  <p className="text-sm text-muted-foreground">
                    The second step adds content while the shared shell animates the height.
                  </p>
                )}
              </div>
            </TakeoverScreen>
          </div>
        </RecipeSection>

        <RecipeSection
          title="Form with validation"
          description="FormField wires the label, help, invalid state, and message to the input."
          source={sources.form}
        >
          <Form onSubmit={validateForm} className="max-w-xl">
            <FormField
              label="Project name"
              name="project-name"
              description="At least three characters."
              error={projectNameError}
              required
              control={(field) => (
                <Input
                  {...field}
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              )}
            />
            <FormActions
              primary={
                <Button variant="primary" type="submit">
                  Create project
                </Button>
              }
            />
            <output className="text-sm text-muted-foreground">{formResult}</output>
          </Form>
        </RecipeSection>
      </div>
    </>
  );
}

export default RecipesPage;
