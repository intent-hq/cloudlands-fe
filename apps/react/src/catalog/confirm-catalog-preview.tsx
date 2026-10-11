// Source: PatternCatalogPreview.svelte (confirm branch).
// i18n-ignore (reference catalog fixture content)
import { ContentDialog, DestructiveConfirm, FormDialog } from '@/components/patterns/confirm';
import { Button } from '@/components/ui/button';
import { InputMessage } from '@/components/ui/input-message';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function ConfirmCatalogState({
  state,
  fixture,
}: {
  state: string;
  fixture: UiComponentFixture;
}) {
  if (fixture.id === 'content-dialog')
    return (
      <ContentDialog
        open
        static
        title={state === 'progress' ? 'Importing workspace' : 'Workspace details'}
        description="Keep the decision clear and supporting details in the body."
        busy={state === 'progress'}
        footer={
          <>
            <Button variant="ghost" disabled={state === 'progress'}>
              Close
            </Button>
            {state === 'error' && <Button variant="primary">Try again</Button>}
          </>
        }
      >
        {state === 'error' ? (
          <InputMessage tone="error">
            The connection was interrupted. Your file is unchanged.
          </InputMessage>
        ) : state === 'progress' ? (
          <output className="block type-body">Importing the selected workspace…</output>
        ) : (
          Array.from({ length: state === 'long-content' ? 30 : 1 }, (_, index) => (
            <p key={index} className="type-body">
              Workspace detail {index + 1}. Supporting information stays in one scrollable region.
            </p>
          ))
        )}
      </ContentDialog>
    );
  if (fixture.id === 'destructive-confirm')
    return (
      <DestructiveConfirm
        open
        static
        title="Remove workspace"
        description="This action cannot be undone."
        confirmLabel="Remove workspace"
        busy={state === 'busy'}
        onConfirm={() => undefined}
      />
    );
  return (
    <FormDialog
      open
      static
      title={fixture.title}
      description="Review and confirm this catalog action."
      busy={state === 'busy'}
      canSubmit={state !== 'invalid'}
      showCancel={state !== 'alert'}
      onSubmit={() => undefined}
    />
  );
}
