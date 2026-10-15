import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { store } from '@/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormDialog } from '@/components/patterns/confirm';
import { FormField } from '@/components/patterns/form';
import { DirectoryPickerModal } from '@/features/onboarding/messages/directory-picker-modal';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import {
  selectWorkspaceInitializerState,
  selectWorkspaceInitializerGitAvailability,
  selectWorkspaceLocalCreationAuthority,
  selectWorkspaceLocalCreation,
  selectWorkspaceLocalCreationProgress,
  selectWorkspaceLocalCreationReady,
} from '@/store/workspace-initializer/workspace-initializer-selectors';
import {
  workspaceLocalCreationOpened,
  workspaceLocalCreationReloadRequested,
  workspaceLocalCreationClosed,
  localWorkspaceCreateRequested,
  setCompactWorkspaceInitializerFormState,
  workspaceInitializerGitCheckRequested,
} from '../../../../../src/store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import {
  createProgressLabel,
  formatCreateProgressPercent,
} from '../../../../../src/lib/components/workspace/initializer/create-progress-label';
import { m } from '$shared/paraglide/messages.js';

export function WorkspaceCreate() {
  const [open, setOpen] = useState(false);
  const authority = selectWorkspaceLocalCreationAuthority().value;
  const context = selectPrincipalActionContext().value;
  return (
    <>
      <Button size="sm" disabled={!authority} onClick={() => setOpen(true)}>
        {m.home_new_workspace()}
      </Button>
      {open && authority && context && (
        <WorkspaceCreateForm
          key={context}
          authority={authority}
          context={context}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function WorkspaceCreateForm({
  authority,
  context,
  onClose,
}: {
  authority: string;
  context: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [picker, setPicker] = useState(false);
  const [consumer] = useState(() => crypto.randomUUID());
  const activated = useRef(false);
  const state = selectWorkspaceInitializerState().value;
  const receiptReady = selectWorkspaceLocalCreationReady().value;
  const outcome = selectWorkspaceLocalCreation().value;
  const git = selectWorkspaceInitializerGitAvailability().value;
  const progress = selectWorkspaceLocalCreationProgress().value;
  const form = state.compactFormState;
  const pending = outcome?.status === 'pending';
  const uncertain = outcome?.status === 'uncertain';
  const locked = pending || uncertain;
  useLayoutEffect(() => {
    store.dispatch(workspaceLocalCreationOpened(consumer, context));
    store.dispatch(workspaceInitializerGitCheckRequested());
    return () => {
      activated.current = false;
      store.dispatch(workspaceLocalCreationClosed(consumer));
    };
  }, [consumer, context]);
  useLayoutEffect(() => {
    if (!activated.current || outcome?.status !== 'success' || !outcome.workspaceId) return;
    activated.current = false;
    onClose();
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: outcome.workspaceId },
      search: {},
    });
  }, [outcome, navigate, onClose]);
  const update = (values: { repoPath?: string; branch?: string }) => {
    if (locked) return;
    const current = selectWorkspaceInitializerState.select(store.state).compactFormState;
    store.dispatch(
      setCompactWorkspaceInitializerFormState({
        ...current,
        ...values,
        repoType: 'local',
        isNewRepo: false,
        skipIsolation: false,
      }),
    );
  };
  const submit = (retry = false) => {
    if (selectWorkspaceLocalCreationAuthority.select(store.state) !== authority) return;
    activated.current = true;
    store.dispatch(localWorkspaceCreateRequested(authority, retry));
  };
  return (
    <>
      <FormDialog
        open
        title={m.workspace_compactInitializer_createWorkspace_label()}
        description={m.workspace_localCreate_scope_description()}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
        onCancel={onClose}
        submitLabel={m.workspace_compactInitializer_createWorkspace_label()}
        submitBusy={pending}
        canSubmit={
          receiptReady &&
          git === true &&
          !locked &&
          !!form?.repoPath?.trim() &&
          !!form?.branch?.trim()
        }
        onSubmit={() => submit()}
      >
        <div className="grid gap-4" data-testid="workspace-local-create">
          <FormField
            label={m.workspace_localCreate_repository_label()}
            disabled={locked || !state.hydrated}
            control={(props) => (
              <div className="flex min-w-0 gap-2">
                <Input
                  {...props}
                  value={form?.repoPath ?? ''}
                  onChange={(event) => update({ repoPath: event.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || !state.hydrated}
                  onClick={() => setPicker(true)}
                >
                  {m.onboarding_dirPicker_selectFolder_label()}
                </Button>
              </div>
            )}
          />
          <FormField
            label={m.workspace_localCreate_baseRef_label()}
            disabled={locked || !state.hydrated}
            control={(props) => (
              <Input
                {...props}
                value={form?.branch ?? ''}
                onChange={(event) => update({ branch: event.target.value })}
              />
            )}
          />
          {!receiptReady && (
            <div className="grid gap-2">
              <output className="type-caption text-muted-foreground">
                {m.workspace_localCreate_receiptUnavailable_description()}
              </output>
              <Button
                type="button"
                variant="outline"
                onClick={() => store.dispatch(workspaceLocalCreationReloadRequested())}
              >
                {m.ui_errorToast_retry_label()}
              </Button>
            </div>
          )}
          {git !== true && (
            <output className="type-caption text-muted-foreground">
              {m.workspace_localCreate_gitPending_description()}
            </output>
          )}
          {pending && (
            <output className="type-body text-muted-foreground">
              {progress?.sawFrame ? (
                <>
                  {createProgressLabel(progress)}{' '}
                  <span>{formatCreateProgressPercent(progress.percent)}</span>
                </>
              ) : (
                m.workspace_modals_creating_label()
              )}
            </output>
          )}
          {outcome?.error && (
            <p role="alert" className="type-caption text-destructive">
              {outcome.error}
            </p>
          )}
          {uncertain && (
            <div className="grid gap-2">
              <output className="type-caption text-muted-foreground">
                {m.workspace_localCreate_uncertain_description()}
              </output>
              <Button type="button" variant="outline" onClick={() => submit(true)}>
                {m.workspace_localCreate_recover_label()}
              </Button>
            </div>
          )}
        </div>
      </FormDialog>
      {picker && (
        <DirectoryPickerModal
          open
          initialPath={form?.repoPath}
          onClose={() => setPicker(false)}
          onSelect={(path) => {
            update({ repoPath: path });
            setPicker(false);
          }}
        />
      )}
    </>
  );
}
