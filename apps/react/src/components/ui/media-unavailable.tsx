// Source: src/lib/components/ui/MediaUnavailable.svelte.
import { useLayoutEffect, useRef } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { notify } from '@/components/patterns/notify';
import { Button } from '@/components/ui/button';
import { writeTextToClipboard } from '@/lib/clipboard';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import {
  faArrowUpRightFromSquare,
  faCopy,
  faTriangleExclamation,
} from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { LinkHandlerOptions } from '$shared/utils/link-helpers';

export type MediaUnavailableReason = 'missing' | 'unsupported' | 'load-failed';

export interface MediaUnavailableProps {
  name?: string;
  reason: MediaUnavailableReason;
  path?: string;
  workspaceId?: string;
  /** The host supplies the canonical link handler for workspace file navigation. */
  onOpenLink: (
    url: string,
    options: Required<Pick<LinkHandlerOptions, 'workspaceId'>>,
  ) => boolean | Promise<boolean>;
}

export function MediaUnavailable({
  name,
  reason,
  path,
  workspaceId,
  onOpenLink,
}: MediaUnavailableProps) {
  const title = useRef<HTMLSpanElement>(null);
  const titleObserver = useRef<ReturnType<typeof truncatedTitle>>(undefined);

  useLayoutEffect(() => {
    if (!title.current) return;
    const observer = truncatedTitle(title.current, undefined);
    titleObserver.current = observer;
    return () => {
      observer?.destroy?.();
      titleObserver.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    titleObserver.current?.update?.(name);
  }, [name]);

  const reasonText =
    reason === 'missing'
      ? m.ui_mediaUnavailable_missing_description()
      : reason === 'unsupported'
        ? m.ui_mediaUnavailable_unsupported_description()
        : m.ui_mediaUnavailable_loadFailed_description();

  async function copyPath() {
    if (!path) return;
    try {
      await writeTextToClipboard(path);
      notify.success(m.ui_imageActionsMenu_pathCopied_label());
    } catch {
      notify.error(m.ui_imageActionsMenu_copyFailed_error());
    }
  }

  function openFile() {
    if (!path || !workspaceId) return;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    void onOpenLink(`intent://local/file/${encodedPath}`, {
      workspaceId: WorkspaceId(workspaceId),
    });
  }

  return (
    <div
      className="flex w-fit min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-2 text-muted-foreground"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source media status container and its actions.
      role="status"
      data-testid="media-unavailable"
      data-reason={reason}
    >
      <IconDefinitionIcon icon={faTriangleExclamation} className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span ref={title} className="type-caption block truncate font-medium text-foreground">
          {name || m.ui_mediaUnavailable_title_label()}
        </span>
        <span className="type-caption block">{reasonText}</span>
      </span>
      {path && (
        <span className="flex shrink-0 items-center gap-1">
          <Button variant="ghost-light" size="xs" className="h-6" onClick={copyPath}>
            <IconDefinitionIcon icon={faCopy} size="0.75em" />
            {m.ui_imageActionsMenu_copyPath_label()}
          </Button>
          {workspaceId && (
            <Button variant="ghost-light" size="xs" className="h-6" onClick={openFile}>
              <IconDefinitionIcon icon={faArrowUpRightFromSquare} size="0.75em" />
              {m.chat_changesPanel_openFile_tooltip()}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}

export default MediaUnavailable;
