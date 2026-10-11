// Source fixtures: PatternCatalogPreview.svelte, ScreenHarness.svelte, FormHarness.svelte.
import { SettingsPreview } from '@/components/patterns/settings';
import { ActionMenuHarness } from './menu-catalog-preview';
import { CollectionCatalogState } from './collection-catalog-preview';
import { ConfirmCatalogState } from './confirm-catalog-preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SizeProvider } from '@/components/ui/size-context';
import {
  Screen,
  ScreenHeader,
  ScreenBody,
  ScreenFooter,
  EmptyState,
  ErrorState,
  LoadingState,
  TakeoverScreen,
} from '@/components/patterns/screen';
import { Form, FormField, FormRow, FormActions } from '@/components/patterns/form';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

function ScreenHarness({ state }: { state: string }) {
  const title = <h1>Example screen</h1>;
  const description = <p>Screen description</p>;
  const secondary = <Button variant="outline">Cancel</Button>;
  const primary = <Button>Continue</Button>;
  if (state === 'takeover')
    return (
      <TakeoverScreen
        title={title}
        description={description}
        counter={<span>2 of 3</span>}
        secondary={secondary}
        primary={primary}
      >
        <p>Screen body</p>
      </TakeoverScreen>
    );
  if (state === 'empty')
    return (
      <EmptyState
        description={<p>Nothing here yet</p>}
        actionLabel="Continue"
        onAction={() => undefined}
      />
    );
  if (state === 'error' || state === 'error-danger')
    return (
      <ErrorState
        message={<p>We could not load this screen</p>}
        retryLabel="Retry"
        onRetry={() => undefined}
        details={<p>Error details</p>}
        detailsLabel="Details"
        severity={state === 'error-danger' ? 'danger' : 'routine'}
      />
    );
  if (state.startsWith('loading'))
    return (
      <LoadingState
        recipe={
          state === 'loading-list' ? 'list' : state === 'loading-card-grid' ? 'card-grid' : 'form'
        }
        count={2}
        label="Loading screen"
      />
    );
  return (
    <Screen>
      <ScreenHeader title={title} description={description} />
      <ScreenBody>
        <p>Screen body</p>
      </ScreenBody>
      <ScreenFooter secondary={secondary} primary={primary} />
    </Screen>
  );
}

function FormHarness({
  error = 'Enter a valid name.',
  busy = false,
}: {
  error?: string;
  busy?: boolean;
}) {
  return (
    <SizeProvider size="compact">
      <Form busy={busy} onSubmit={() => undefined}>
        <FormRow>
          <FormField
            label="Name"
            name="name"
            description="Shown to collaborators."
            error={error}
            required
            control={(field) => <Input {...field} />}
          />
          <FormField
            label="Notes"
            description="Optional details."
            control={(field) => <Textarea {...field} />}
          />
        </FormRow>
        <FormActions
          destructive={
            <Button data-action="destructive" variant="destructive">
              Delete
            </Button>
          }
          secondary={
            <Button data-action="secondary" variant="outline">
              Cancel
            </Button>
          }
          primary={
            <Button data-action="primary" variant="primary" type="submit">
              Save
            </Button>
          }
          hint="⌘↵"
        />
      </Form>
    </SizeProvider>
  );
}

export function PatternCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  return (
    <div data-pattern-contract={componentId} data-catalog-renderer-fixture={fixture.id}>
      {fixture.states.map((state) => (
        <section key={state} data-catalog-rendered-state={state}>
          {componentId === 'settings' ? (
            <SettingsPreview searchQuery={state === 'filtered' ? 'choice' : ''} />
          ) : componentId === 'collection' ? (
            <CollectionCatalogState state={state} />
          ) : componentId === 'action-menu' ? (
            <ActionMenuHarness
              bar={state === 'action-bar' || state === 'overflow'}
              context={state === 'context-menu'}
            />
          ) : componentId === 'confirm' ? (
            <ConfirmCatalogState state={state} fixture={fixture} />
          ) : componentId === 'screen' ? (
            <ScreenHarness state={state} />
          ) : (
            <FormHarness error={state === 'error' ? undefined : ''} busy={state === 'submitting'} />
          )}
        </section>
      ))}
    </div>
  );
}
