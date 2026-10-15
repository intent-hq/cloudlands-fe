import { observeDesktopFileViewRetirement } from '@/store/files/sagas/desktop-file-lifetime';
import { selectDesktopFileIdentity } from '@/store/files/desktop-file-selectors';
import { selectDesktopFileEditRetired } from '@/store/files/desktop-file-selectors';
import * as Menu from '@/components/ui/menu';
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { toggleLineWrapping } from '../../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '@/components/editor/code-editor';
import { MarkdownViewer } from '@/components/markdown/markdown-viewer';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import {
  selectFileContentEntry,
  selectFileAbsolutePath,
  selectFileReadContext,
  selectFileSaveState,
} from '@/store/files/files-selectors';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectIsDarkTheme } from '@/store/theme/theme-selectors';
import { selectCodeFontFamilyCSS } from '@/store/user-preferences/user-preferences-selectors';
import { selectDiffIndicators, selectLineWrapping } from '@/store/ui-layout/ui-layout-selectors';
import {
  loadFileContentRequested,
  updateFileContent,
  saveFileContentRequested,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import { captureFileSaveAuthority } from '@/features/workspace/file-save-runtime';
import { canEditWorkspaceText } from '@/features/workspace/workspace-file-edit-policy';
import { getLanguageFromPath } from '$lib/utils/file-utils';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { getEffectiveShortcut } from '@/lib/effective-shortcuts';
import { isMacPlatform } from '$lib/utils/shortcuts';
import { WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { openDesktopFile, openDesktopFileLink } from './desktop-file-open';

/** Source FileTabType binding: file text, revisions and writes remain in the canonical file owners. */
export function DesktopFile({
  workspaceId,
  path,
  panelId,
  tabId,
  active,
  line,
  jumpTimestamp,
  preview = false,
  onUnavailable,
}: {
  workspaceId: string;
  path: string;
  panelId: string;
  tabId: string;
  active: boolean;
  line?: number;
  jumpTimestamp?: number;
  preview?: boolean;
  onUnavailable: (label: string) => void;
}) {
  const entry = selectFileContentEntry(workspaceId, path).value;
  const authority = selectFileReadContext(workspaceId).value;
  const absolute = selectFileAbsolutePath(workspaceId, path).value;
  const identity = selectDesktopFileIdentity(workspaceId, path).value;
  const state = selectFileSaveState(workspaceId, path).value;
  const retiredEdit = selectDesktopFileEditRetired(workspaceId, path).value;
  const dark = selectIsDarkTheme().value,
    font = selectCodeFontFamilyCSS().value;
  const wrap = selectLineWrapping().value;
  const lease = useMemo(
    () => ({ workspaceId, path, authority, absolute, identity }),
    [workspaceId, path, authority, absolute, identity],
  );
  const mounted = useRef<typeof lease | null>(null);
  const edited = useRef<typeof lease | null>(null);
  const [editedLease, setEditedLease] = useState<typeof lease | null>(null);
  const identityCurrent = useCallback(
    () =>
      !!authority &&
      !!absolute &&
      selectFileReadContext.select(store.state, workspaceId) === authority &&
      selectDesktopFileIdentity.select(store.state, workspaceId, path) === identity,
    [authority, absolute, workspaceId, path, identity],
  );
  const current = useCallback(() => {
    const panel = selectDesktopLayout.select(store.state, workspaceId).panels[panelId];
    return (
      mounted.current === lease &&
      active &&
      !selectDesktopFileEditRetired.select(store.state, workspaceId, path) &&
      identityCurrent() &&
      selectCurrentWorkspaceTabId.select(store.state) === workspaceId &&
      panel?.activeTabId === tabId &&
      panel.tabs.some((t) => t.id === tabId && t.type === 'file' && t.filePath === path)
    );
  }, [panelId, workspaceId, lease, active, path, identityCurrent, tabId]);
  const flush = useCallback(
    (deliberate = false) => {
      if (
        !identityCurrent() ||
        edited.current !== lease ||
        selectDesktopFileEditRetired.select(store.state, workspaceId, path)
      )
        return;
      const entry = selectFileContentEntry.select(store.state, workspaceId, path);
      const status = selectFileSaveState.select(store.state, workspaceId, path);
      const writeAuthority = captureFileSaveAuthority(workspaceId, path, absolute);
      if (
        !writeAuthority ||
        status.uncertain ||
        (!deliberate && !!status.error) ||
        entry?.kind !== 'editable-text' ||
        entry.absolutePath !== absolute ||
        entry.truncated ||
        (entry.localContent === entry.originalContent && !entry.saving) ||
        !canEditWorkspaceText(entry.localContent)
      )
        return;
      store.dispatch(
        saveFileContentRequested(
          workspaceId,
          path,
          absolute,
          { kind: 'editable-text', content: entry.localContent },
          { requestId: crypto.randomUUID(), authority: writeAuthority, serialize: true },
        ),
      );
    },
    [identityCurrent, lease, workspaceId, path, absolute],
  );
  useLayoutEffect(() => {
    mounted.current = lease;
    return () => {
      // Like source: flush the captured resource on actual retirement; a changed authority never adopts it.
      if (mounted.current === lease) {
        flush();
        mounted.current = null;
      }
    };
  }, [lease, flush]);
  useLayoutEffect(() => {
    if (current() && !entry) store.dispatch(loadFileContentRequested(workspaceId, path, absolute));
  }, [workspaceId, path, absolute, current, entry]);
  useLayoutEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        current() &&
        matchesShortcut(event, getEffectiveShortcut('editor.save'), isMacPlatform())
      ) {
        event.preventDefault();
        flush(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, current, flush]);
  if (!authority || !absolute)
    return <output className="p-6 text-subtle">{m.layout_fileTab_outsideWorkspace_label()}</output>;
  if (!entry || entry.loading)
    return <LoadingState label={m.workspace_noteVersionHistory_loading_label()} />;
  const retry = () => {
    if (!current()) return;
    if (entry.kind === 'editable-text') {
      // Only a deliberate retry may adopt the visible failed draft in the same authority.
      if (!selectFileSaveState.select(store.state, workspaceId, path).error) return;
      edited.current = lease;
      setEditedLease(lease);
      flush(true);
    } else store.dispatch(loadFileContentRequested(workspaceId, path, absolute));
  };
  if (entry.kind !== 'editable-text')
    return (
      <div className="p-6 text-subtle">
        <output>{entry.error || m.workspace_fileEdit_readOnly_description()}</output>
        {entry.error && <Button onClick={retry}>{m.ui_combobox_retry_label()}</Button>}
      </div>
    );
  const bounded =
    entry.absolutePath === absolute &&
    !entry.truncated &&
    canEditWorkspaceText(entry.originalContent) &&
    canEditWorkspaceText(entry.localContent);
  const changedOwner =
    entry.localContent !== entry.originalContent && (retiredEdit || editedLease !== lease);
  const readOnly =
    changedOwner ||
    !bounded ||
    !captureFileSaveAuthority(workspaceId, path, absolute) ||
    state.uncertain;
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-desktop-file={path}
      data-file-dirty={entry.localContent !== entry.originalContent}
    >
      {(entry.error || state.error || state.uncertain || !bounded || changedOwner) && (
        <div role="alert" className="flex items-center gap-2 px-3 py-1 text-danger type-caption">
          {state.uncertain
            ? m.workspace_fileEdit_uncertain_error()
            : entry.error || state.error || m.workspace_fileEdit_readOnly_description()}
          {!state.uncertain && !retiredEdit && !!state.error && bounded && (
            <Button size="sm" variant="ghost" onClick={retry}>
              {m.ui_combobox_retry_label()}
            </Button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {preview ? (
          <div className="h-full overflow-auto p-4">
            <MarkdownViewer
              content={entry.localContent}
              workspaceId={workspaceId}
              workspaceContext={{ workspaceId: WorkspaceId(workspaceId) }}
              renderRichFencesAsCode
              onOpenLink={(url, options) => {
                if (
                  openDesktopFileLink(
                    workspaceId,
                    url,
                    { ...options, sourcePanelId: panelId },
                    current,
                  )
                )
                  return true;
                onUnavailable(m.desktop_shell_unported_description());
                return true;
              }}
              onOpenNote={() => onUnavailable(m.desktop_shell_unported_description())}
              onOpenFile={(ws, file, options) => {
                if (ws === workspaceId)
                  openDesktopFile(ws, file, current, { ...options, sourcePanelId: panelId });
              }}
            />
          </div>
        ) : (
          <CodeEditor
            fill
            value={entry.localContent}
            path={`${workspaceId}/${path}/${tabId}`}
            fileName={path}
            language={getLanguageFromPath(path)}
            dark={dark}
            fontFamily={font}
            readOnly={readOnly}
            line={line}
            jumpTimestamp={jumpTimestamp}
            active={active}
            lineWrapping={wrap}
            onSave={() => {
              if (current()) flush(true);
            }}
            onChange={(content) => {
              if (current() && !readOnly) {
                edited.current = lease;
                setEditedLease(lease);
                store.dispatch(
                  updateFileContent(workspaceId, path, { kind: 'editable-text', content }),
                );
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Source file display actions, alongside explicitly scoped actions not yet ported. */
export function DesktopFileMenu({
  workspaceId,
  path,
  panelId,
  tabId,
  active,
  preview,
  onPreview,
  onUnavailable,
}: {
  workspaceId: string;
  path: string;
  panelId: string;
  tabId: string;
  active: boolean;
  preview: boolean;
  onPreview: () => void;
  onUnavailable: (label: string) => void;
}) {
  const entry = selectFileContentEntry(workspaceId, path).value;
  const wrap = selectLineWrapping().value;
  const diff = selectDiffIndicators().value;
  const absolute = selectFileAbsolutePath(workspaceId, path).value;
  const authority = selectFileReadContext(workspaceId).value;
  const identity = selectDesktopFileIdentity(workspaceId, path).value;
  const lifetime = useMemo(
    () => ({ workspaceId, path, panelId, tabId, active, authority, identity }),
    [workspaceId, path, panelId, tabId, active, authority, identity],
  );
  const mounted = useRef<typeof lifetime | null>(null);
  useLayoutEffect(() => {
    mounted.current = lifetime;
    const stop = store.runSaga(function* () {
      yield* observeDesktopFileViewRetirement(workspaceId, path, panelId, tabId, () => {
        mounted.current = null;
      });
    });
    return () => {
      stop();
      mounted.current = null;
    };
  }, [lifetime, workspaceId, path, panelId, tabId]);
  const current = () =>
    mounted.current === lifetime &&
    active &&
    !!authority &&
    selectFileReadContext.select(store.state, workspaceId) === authority &&
    selectDesktopFileIdentity.select(store.state, workspaceId, path) === identity &&
    selectCurrentWorkspaceTabId.select(store.state) === workspaceId &&
    selectDesktopLayout.select(store.state, workspaceId).panels[panelId]?.activeTabId === tabId;
  const enabled = !!absolute && entry?.kind === 'editable-text';
  const unavailable = (label: string) => {
    if (current()) onUnavailable(label);
  };
  return (
    <>
      <Menu.CommandItem
        label={m.workspace_notes_rename_label()}
        onSelect={() => unavailable(m.workspace_notes_rename_label())}
      />
      <Menu.Separator />
      {enabled && (
        <Menu.CommandItem
          icon={FloppyDiskIcon}
          label={
            entry.saving
              ? m.ui_saveIndicator_saving_tooltip()
              : entry.localContent !== entry.originalContent
                ? m.ui_saveIndicator_autoSaving_tooltip()
                : m.ui_saveIndicator_saved_tooltip()
          }
          disabled
        />
      )}
      {enabled && (
        <>
          {/\.md$/i.test(path) && (
            <Menu.CheckboxItem
              checked={preview}
              onCheckedChange={() => {
                if (current()) onPreview();
              }}
            >
              {m.ui_viewSettings_renderedPreview_label()}
            </Menu.CheckboxItem>
          )}
          {(!/\.md$/i.test(path) || !preview) && (
            <Menu.CheckboxItem
              checked={wrap}
              onCheckedChange={() => {
                if (current()) store.dispatch(toggleLineWrapping());
              }}
            >
              {m.ui_viewSettings_wrapLines_label()}
            </Menu.CheckboxItem>
          )}
          <Menu.CheckboxItem
            checked={diff}
            closeOnSelect
            onCheckedChange={() => unavailable(m.ui_viewSettings_diffIndicators_label())}
          >
            {m.ui_viewSettings_diffIndicators_label()}
          </Menu.CheckboxItem>
          <Menu.Separator />
          <Menu.Label>{m.layout_panelTabBar_actionsSection_label()}</Menu.Label>
          <Menu.CommandItem
            icon={PencilSimpleIcon}
            label={m.layout_fileTab_goToChanges_tooltip()}
            onSelect={() => unavailable(m.layout_fileTab_goToChanges_tooltip())}
          />
          <Menu.CommandItem
            icon={DownloadSimpleIcon}
            label={m.layout_fileTab_downloadFile_label()}
            onSelect={() => unavailable(m.layout_fileTab_downloadFile_label())}
          />
          <Menu.CommandItem
            icon={TrashIcon}
            destructive
            label={m.layout_fileTab_deleteFile_tooltip()}
            onSelect={() => unavailable(m.layout_fileTab_deleteFile_tooltip())}
          />
        </>
      )}
      <Menu.Separator />
      <Menu.Group data-panel-actions-section="move">
        <Menu.Label>{m.layout_panelTabBar_movePanel_label()}</Menu.Label>
        <div className="desktop-file-move-pad">
          {(
            [
              ['up', m.layout_panelTabBar_movePanelUp_label()],
              ['right', m.layout_panelTabBar_movePanelRight_label()],
              ['down', m.layout_panelTabBar_movePanelDown_label()],
              ['left', m.layout_panelTabBar_movePanelLeft_label()],
            ] as const
          ).map(([direction, label]) => (
            <Menu.Item
              key={direction}
              className={`desktop-file-move-direction desktop-file-move-${direction}`}
              aria-label={label}
              onSelect={() => unavailable(label)}
            >
              <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
                <g transform="rotate(-90 8 8)" stroke="currentColor" strokeWidth="1.33">
                  <path d="M3 8H12" strokeLinecap="square" />
                  <path
                    d="M8.518 3 12.634 7.116C13.122 7.604 13.122 8.396 12.634 8.884L8.518 13"
                    strokeLinejoin="round"
                  />
                </g>
              </svg>
            </Menu.Item>
          ))}
        </div>
      </Menu.Group>
      <Menu.Separator />
      <Menu.Sub>
        <Menu.SubTrigger leading={<ArrowSquareOutIcon size={12} weight="regular" />}>
          {m.ui_openCombo_openInApp_tooltip()}
        </Menu.SubTrigger>
        <Menu.SubContent>
          <Menu.CommandItem label={m.desktop_shell_unported_description()} disabled />
        </Menu.SubContent>
      </Menu.Sub>
    </>
  );
}
