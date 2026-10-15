import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/patterns/confirm';
import { WorkspaceFileFinder } from './workspace-file-finder';
import { store } from '@/store';
import {
  selectFileExplorerContext,
  selectFileExplorerRoot,
  selectFileSearch,
} from '@/store/file-explorer/file-explorer-selectors';
import {
  fileSearchOpened,
  fileSearchReleased,
} from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import { m } from '$shared/paraglide/messages.js';

function FilePicker({
  workspaceId,
  context,
  root,
  onSelect,
  onClose,
}: {
  workspaceId: string;
  context: string;
  root: string;
  onSelect: (path: string, root: string) => void;
  onClose: () => void;
}) {
  const consumer = useRef<string | null>(null);
  const [consumerId] = useState(() => crypto.randomUUID());
  useLayoutEffect(() => {
    consumer.current = consumerId;
    store.dispatch(fileSearchOpened(workspaceId, consumerId, context));
    return () => {
      consumer.current = null;
      store.dispatch(fileSearchReleased(workspaceId, consumerId));
    };
  }, [workspaceId, consumerId, context]);
  function close() {
    consumer.current = null;
    store.dispatch(fileSearchReleased(workspaceId, consumerId));
    onClose();
  }
  return (
    <FormDialog
      open
      title={m.chat_fileContext_add_label()}
      description={m.chat_fileContext_picker_description()}
      enterKey="ignore"
      modEnter="ignore"
      onSubmit={() => undefined}
      onCancel={close}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      footer={
        <Button variant="ghost" onClick={close}>
          {m.modals_bulkActionConfirm_cancel_label()}
        </Button>
      }
    >
      <WorkspaceFileFinder
        workspaceId={workspaceId}
        consumerId={consumerId}
        context={context}
        root={root}
        onOpen={(path) => {
          const search = selectFileSearch.select(store.state, workspaceId, consumerId, context);
          if (
            consumer.current !== consumerId ||
            selectFileExplorerContext.select(store.state, workspaceId) !== context ||
            !search?.settled ||
            search.error ||
            !search.paths.includes(path)
          )
            return;
          onSelect(path, root);
          close();
        }}
      />
    </FormDialog>
  );
}

/** Search records belong to the existing explorer owner; only popup lifetime is local. */
export function WorkspaceConversationFilePicker({
  workspaceId,
  disabled,
  onSelect,
}: {
  workspaceId: string;
  disabled: boolean;
  onSelect: (path: string, root: string) => void;
}) {
  const context = selectFileExplorerContext(workspaceId).value;
  const root = selectFileExplorerRoot(workspaceId).value;
  const [openContext, setOpenContext] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !context}
        onClick={() => setOpenContext(selectFileExplorerContext.select(store.state, workspaceId))}
      >
        {m.chat_fileContext_add_label()}
      </Button>
      {context && openContext === context && (
        <FilePicker
          key={context}
          workspaceId={workspaceId}
          context={context}
          root={root}
          onSelect={onSelect}
          onClose={() => setOpenContext(null)}
        />
      )}
    </>
  );
}
