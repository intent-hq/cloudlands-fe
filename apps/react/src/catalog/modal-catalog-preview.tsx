// Source: src/lib/component-catalog/renderers/ModalCatalogPreview.svelte.
// i18n-ignore (exact internal source fixtures and migration coverage ledger)
import { useId } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputMessage } from '@/components/ui/input-message';
import { Label } from '@/components/ui/label';
import { SizeProvider } from '@/components/ui/size-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmRequestView, DestructiveConfirm, FormDialog } from '@/components/patterns/confirm';
import { InputDialog } from '@/components/modals/input-dialog';
import { MessageDialog } from '@/components/modals/message-dialog';
import { BulkActionConfirmDialog } from '@/components/modals/bulk-action-confirm-dialog';
import { ReplaceAgentModal } from '@/components/modals/replace-agent-modal';
import { HarnessFeaturesModal } from '@/components/chat/harness-features-modal';
import { DismissProposalConfirmDialog } from '@/components/chat/proposals/dismiss-proposal-confirm-dialog';
import { ModelSwitchConfirmDialog } from '@/components/chat/model-switch-confirm-dialog';
import { SetPrimaryClientConfirmDialog } from '@/components/workspace/set-primary-client-confirm-dialog';
import { DismissQuestionsConfirmDialog } from '@/components/chat/questions/dismiss-questions-confirm-dialog';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import './modal-catalog-preview.css';

const primitiveStates = [
  ['default', 'Default'],
  ['no-description', 'No description'],
  ['title-only', 'Title only'],
  ['with-icon-header', 'Icon header'],
  ['size-sm', 'Small'],
  ['size-lg', 'Large'],
  ['compact-density', 'Compact density'],
  ['long-content-scrolling', 'Long content scrolling'],
  ['busy', 'Busy'],
  ['invalid', 'Invalid'],
  ['destructive', 'Destructive'],
  ['disabled-close', 'Disabled close'],
  ['nested-content', 'Nested content'],
  ['zoom-200', '200% zoom'],
  ['reduced-motion', 'Reduced motion'],
] as const;
type ModalState = (typeof primitiveStates)[number][0];

const productStates = [
  ['confirm-host-confirm', 'ConfirmHost — confirm'],
  ['confirm-host-prompt', 'ConfirmHost — prompt'],
  ['confirm-host-alert', 'ConfirmHost — alert'],
  ['confirm-host-busy', 'ConfirmHost — busy'],
  ['set-primary-client-confirm-dialog', 'SetPrimaryClientConfirmDialog'],
  ['destructive-confirm-default', 'DestructiveConfirm — default'],
  ['destructive-confirm-busy', 'DestructiveConfirm — busy'],
  ['form-dialog-default', 'FormDialog — default'],
  ['form-dialog-busy', 'FormDialog — busy'],
  ['form-dialog-invalid', 'FormDialog — invalid'],
  ['input-dialog', 'InputDialog'],
  ['message-dialog', 'MessageDialog'],
  ['bulk-action-confirm-dialog', 'BulkActionConfirmDialog'],
  ['replace-agent-modal', 'ReplaceAgentModal'],
  ['harness-features-modal', 'HarnessFeaturesModal'],
  ['model-switch-confirm-dialog', 'ModelSwitchConfirmDialog'],
  ['dismiss-proposal-confirm-dialog', 'DismissProposalConfirmDialog'],
  ['dismiss-questions-confirm-dialog', 'DismissQuestionsConfirmDialog'],
] as const;
type ProductModalState = (typeof productStates)[number][0];

const unsupportedStates = [
  ['workspace-warning-dialogs', 'WorkspaceWarningDialogs and workspace warning state'],
  ['setup-prompt-dialog', 'SetupPromptDialog and backend setup state'],
  ['pull-conflict-dialog', 'PullConflictDialog and editor conflict integration'],
  ['feature-code-dialog', 'FeatureCodeDialog and feature activation state'],
  [
    'directory-picker-modal',
    'DirectoryPickerModal exact source catalog composition is not integrated here',
  ],
  ['delete-warning-dialog', 'DeleteWarningDialog and workspace safety composition'],
  [
    'archive-warning-dialog',
    'DeleteWarningDialog archive composition (present in renderer, absent from catalog.ts states)',
  ],
  ['quit-confirmation-modal', 'QuitConfirmationModal and running work/browser composition'],
  ['release-notes-modal', 'ReleaseNotesModal and release-note rendering'],
  ['git-credentials-modal', 'GitCredentialsModal and terminal retry integration'],
  ['git-credentials-no-context', 'GitCredentialsModal without workspace context'],
  ['import-workspace-modal', 'ImportWorkspaceModal and import lifecycle'],
  ['transfer-workspace-modal', 'TransferWorkspaceModal and transfer lifecycle'],
  ['new-space-modal', 'NewSpaceModal and workspace initializer composition'],
  ['setup-script-modal', 'SetupScriptModal and its real editor integration'],
  ['interrupted-agents-modal', 'InterruptedAgentsModal and recovery selection'],
  ['interrupted-agent-single', 'InterruptedAgentsModal single-agent recovery'],
  ['interrupted-agents-many', 'InterruptedAgentsModal long recovery list'],
  ['interrupted-agents-retry', 'InterruptedAgentsModal recovery failure/retry'],
  ['add-remote-setup-modal', 'AddRemoteSetupModal and remote setup composition'],
] as const;

function PrimitivePreview({ state }: { state: ModalState }) {
  const descriptionId = useId();
  return (
    <div className={state === 'zoom-200' ? 'modal-zoom-preview' : undefined}>
      <Dialog open staticPosition>
        <DialogContent
          size={
            state === 'size-lg' || state === 'zoom-200'
              ? 'lg'
              : state === 'size-sm'
                ? 'sm'
                : 'default'
          }
          closeDisabled={state === 'busy' || state === 'disabled-close'}
          className={state === 'long-content-scrolling' ? 'max-h-72' : undefined}
          aria-describedby={
            state === 'no-description' || state === 'title-only' ? undefined : descriptionId
          }
        >
          {state === 'with-icon-header' ? (
            <DialogHeader className="flex-row items-start">
              <span className="mt-0.5 text-danger">
                <WarningCircleIcon size="1em" aria-hidden="true" />
              </span>
              <div className="grid gap-1.5">
                <DialogTitle>Review this change</DialogTitle>
                <DialogDescription id={descriptionId} className="sr-only">
                  Check the affected workspace before continuing.
                </DialogDescription>
              </div>
            </DialogHeader>
          ) : state === 'title-only' ? (
            <DialogTitle>Dialog title</DialogTitle>
          ) : (
            <DialogHeader>
              <DialogTitle>
                {state === 'destructive' ? 'Delete workspace?' : 'Edit workspace'}
              </DialogTitle>
              {state !== 'no-description' && (
                <DialogDescription id={descriptionId} className="sr-only">
                  {state === 'invalid'
                    ? 'Resolve the validation error before saving.'
                    : 'Update the workspace details and save your changes.'}
                </DialogDescription>
              )}
            </DialogHeader>
          )}
          {state === 'no-description' ? (
            <p className="type-body text-muted-foreground">
              The description slot is intentionally omitted.
            </p>
          ) : state === 'long-content-scrolling' ? (
            <div className="grid gap-3">
              {Array.from({ length: 10 }, (_, index) => (
                <p className="type-body" key={index}>
                  Workspace detail row {index + 1} remains inside the dialog.
                </p>
              ))}
            </div>
          ) : state === 'invalid' ? (
            <div>
              <Input aria-label="Workspace name" aria-invalid="true" defaultValue="" />
              <InputMessage tone="error">A workspace name is required.</InputMessage>
            </div>
          ) : state === 'nested-content' ? (
            <div className="grid gap-3">
              <Input aria-label="Workspace name" defaultValue="Design system" />
              <Input aria-label="Workspace path" defaultValue="/workspaces/design-system" />
            </div>
          ) : state !== 'title-only' ? (
            <p className="type-body text-muted-foreground">
              {state === 'destructive'
                ? 'This removes local workspace data and cannot be undone.'
                : 'The dialog body uses the standard content composition.'}
            </p>
          ) : null}
          {state !== 'title-only' && (
            <DialogFooter>
              <Button variant="ghost" disabled={state === 'busy'}>
                Cancel
              </Button>
              <Button
                variant={state === 'destructive' ? 'destructive' : 'default'}
                loading={state === 'busy'}
                disabled={state === 'invalid'}
              >
                {state === 'destructive' ? 'Delete workspace' : 'Save changes'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductPreview({ state }: { state: ProductModalState }) {
  const uid = useId();
  switch (state) {
    case 'set-primary-client-confirm-dialog':
      return <SetPrimaryClientConfirmDialog open static currentHost="Studio Mac" />;
    case 'model-switch-confirm-dialog':
      return (
        <ModelSwitchConfirmDialog
          open
          static
          isProviderChange
          fromProviderName="Augment"
          fromProviderId="auggie"
          fromModelLabel="Claude Sonnet 4.6"
          toProviderName="OpenAI"
          toProviderId="codex"
          toModelLabel="GPT-5.6"
        />
      );
    case 'dismiss-questions-confirm-dialog':
      return <DismissQuestionsConfirmDialog open static />;
    case 'confirm-host-confirm':
    case 'confirm-host-busy':
      return (
        <ConfirmRequestView
          static
          busy={state === 'confirm-host-busy'}
          request={{
            kind: 'confirm',
            options: {
              title: 'Delete workspace?',
              destructive: true,
              confirmLabel: 'Delete workspace',
            },
          }}
          onAccept={() => {}}
          onCancel={() => {}}
        />
      );
    case 'confirm-host-prompt':
      return (
        <ConfirmRequestView
          static
          value="Design system"
          request={{
            kind: 'prompt',
            options: {
              title: 'Rename workspace',
              field: { label: 'Workspace name', required: true },
            },
          }}
          onAccept={() => {}}
          onCancel={() => {}}
        />
      );
    case 'confirm-host-alert':
      return (
        <ConfirmRequestView
          static
          request={{ kind: 'alert', options: { title: 'Workspace ready' } }}
          onAccept={() => {}}
          onCancel={() => {}}
        />
      );
    case 'destructive-confirm-default':
    case 'destructive-confirm-busy':
      return (
        <DestructiveConfirm
          open
          static
          busy={state === 'destructive-confirm-busy'}
          title={state === 'destructive-confirm-busy' ? 'Deleting workspace' : 'Delete workspace?'}
          confirmLabel="Delete workspace"
          onConfirm={() => {}}
          details={
            <p className="type-body">
              {state === 'destructive-confirm-busy'
                ? 'Local workspace data is being removed.'
                : 'This action cannot be undone.'}
            </p>
          }
        />
      );
    case 'form-dialog-default':
      return (
        <FormDialog
          open
          static
          title="Rename workspace"
          submitLabel="Save name"
          onSubmit={() => {}}
        >
          <Label htmlFor={`${uid}-workspace-name`}>Workspace name</Label>
          <Input id={`${uid}-workspace-name`} defaultValue="Design system" />
        </FormDialog>
      );
    case 'form-dialog-busy':
      return (
        <FormDialog
          open
          static
          busy
          title="Rename workspace"
          submitLabel="Saving…"
          onSubmit={() => {}}
        >
          <p className="type-body">Your changes are being saved.</p>
        </FormDialog>
      );
    case 'form-dialog-invalid':
      return (
        <FormDialog
          open
          static
          canSubmit={false}
          title="Rename workspace"
          submitLabel="Save name"
          onSubmit={() => {}}
        >
          <Label htmlFor={`${uid}-invalid-name`}>Workspace name</Label>
          <Input
            id={`${uid}-invalid-name`}
            aria-invalid="true"
            aria-describedby={`${uid}-name-error`}
          />
          <InputMessage id={`${uid}-name-error`} tone="error">
            A workspace name is required.
          </InputMessage>
        </FormDialog>
      );
    case 'input-dialog':
      return (
        <InputDialog
          open
          static
          title="Rename workspace"
          description="Enter a new workspace name."
          placeholder="Workspace name"
        />
      );
    case 'message-dialog':
      return (
        <MessageDialog
          open
          static
          title="Workspace moved"
          message="The workspace is ready on the selected connection."
          buttons={['Dismiss', 'Open workspace']}
        />
      );
    case 'bulk-action-confirm-dialog':
      return (
        <BulkActionConfirmDialog
          open
          static
          title="Archive selected workspaces?"
          description="The selected workspaces will move to the archive."
          confirmText="Archive workspaces"
          variant="destructive"
          mode="archive"
          activeAgentCount={2}
          activeHookCount={1}
          guestCount={3}
        />
      );
    case 'replace-agent-modal':
      return (
        <ReplaceAgentModal open static agentName="Catalog implementor" specialist="implementor" />
      );
    case 'harness-features-modal':
      return (
        <HarnessFeaturesModal
          open
          static
          version="2.3"
          features={{ browserAutomation: true, backgroundHooks: true, structuredQuestions: true }}
        />
      );
    case 'dismiss-proposal-confirm-dialog':
      return <DismissProposalConfirmDialog open static />;
  }
}

export function ModalCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const primitive = fixture.id === 'primitive-dialog-matrix';
  const uid = useId();
  const states = primitive ? primitiveStates : productStates;
  return (
    <div
      className="modal-catalog-preview grid min-w-0 gap-6"
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state={states.map(([state]) => state).join(' ')}
    >
      <section className="grid gap-4" aria-labelledby={`${uid}-title`}>
        <h2 id={`${uid}-title`} className="type-body text-muted-foreground font-normal">
          {primitive ? 'Dialog primitive' : 'Product modals'}
        </h2>
        <div className="modal-preview-grid">
          {primitive
            ? primitiveStates.map(([state, label]) => (
                <article
                  key={state}
                  className="grid min-w-0 content-start gap-2"
                  data-modal-preview={state}
                >
                  <h3 className="type-caption text-muted-foreground font-normal">{label}</h3>
                  <div className="relative min-h-88 overflow-hidden rounded-md bg-muted/40 py-4">
                    {state === 'compact-density' ? (
                      <SizeProvider size="compact">
                        <PrimitivePreview state={state} />
                      </SizeProvider>
                    ) : (
                      <PrimitivePreview state={state} />
                    )}
                  </div>
                </article>
              ))
            : productStates.map(([state, label]) => (
                <article
                  key={state}
                  className="grid min-w-0 content-start gap-2"
                  data-modal-preview={state}
                >
                  <h3 className="type-caption text-muted-foreground font-normal">{label}</h3>
                  <div className="relative min-h-96 overflow-hidden rounded-md bg-muted/40 py-4">
                    <ProductPreview state={state} />
                  </div>
                </article>
              ))}
        </div>
      </section>
      <details data-modal-coverage={primitive ? 'primitive' : 'product'}>
        <summary>
          {primitive
            ? 'Primitive coverage: 15 source states'
            : 'Product coverage: 18 supported source examples; 20 unsupported'}
        </summary>
        <p className="type-body text-muted-foreground">
          Static source fixtures only. Visual, geometry and native interaction acceptance remain
          pending. The reduced-motion state requires the browser motion preference. Callback
          exercises do not verify workspace, proposal or question persistence, model changes, or
          primary-client mutations.
        </p>
        {!primitive && (
          <ul className="grid gap-2">
            {productStates.map(([state, label]) => (
              <li key={state} data-modal-coverage-state={state} data-coverage="implemented">
                {label}: source composition available; acceptance pending.
              </li>
            ))}
            {unsupportedStates.map(([state, dependency]) => (
              <li key={state} data-modal-coverage-state={state} data-coverage="unsupported">
                <code>{state}</code>: unsupported — {dependency}.
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
