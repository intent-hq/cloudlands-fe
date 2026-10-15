// Source: src/lib/components/chat/InlinePermissionRequest.svelte.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { createTransition, fly } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { store as appStore } from '@/store';
import { selectPermissionResponse } from '@/store/permission/permission-selectors';
import { selectWorkspacePermissionContext } from '@/store/workspace/workspace-selectors';
import { getCategoryColor } from '$lib/components/chat/permission-category-classes';
import { parsePermissionRequest } from '$lib/components/chat/permission-parser';
import { shouldHandlePermissionShortcut } from '$lib/components/chat/permission-shortcut';
import { faShieldHalved, faChevronDown, faChevronLeft } from '$lib/icons/phosphor-icon-definitions';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import { selectPermissionOption } from '../../../../../../src/store/renderer/slices/permission/permission-slice';
import type { PermissionRequest } from '../../../../../../src/store/renderer/slices/permission/permission-types';

export interface InlinePermissionRequestProps {
  request: PermissionRequest;
  pendingCount?: number;
  keyboardShortcutsEnabled?: boolean;
  /** Optional DOM owner for hosts that require focused, local shortcuts. */
  keyboardShortcutScope?: RefObject<HTMLElement | null>;
}

export function InlinePermissionRequest({
  request,
  pendingCount = 1,
  keyboardShortcutsEnabled = false,
  keyboardShortcutScope,
}: InlinePermissionRequestProps) {
  const [showDetails, setShowDetails] = useState(false);
  // A synchronous, instance-local guard, matching the source's transient dispatch window.
  const processing = useRef(false);
  const permissionContext = selectWorkspacePermissionContext(request.workspaceId ?? '');
  const response = selectPermissionResponse(request.requestId);
  const renderContext = permissionContext.value;
  const isProcessing = response.value?.status === 'submitting';
  const ref = useRef<HTMLDivElement>(null);

  const display = parsePermissionRequest(request.title, request.description);
  const filtered = request.options.filter((opt) => !opt.id.toLowerCase().includes('always'));
  const optionsWithShortcuts = filtered.map((opt, idx) => ({
    ...opt,
    shortcut: idx < 9 ? String(idx + 1) : null,
  }));

  function handleSelectOption(optionId: string) {
    if (
      processing.current ||
      !request.workspaceId ||
      !renderContext ||
      renderContext !==
        selectWorkspacePermissionContext.select(appStore.state, request.workspaceId) ||
      selectPermissionResponse.select(appStore.state, request.requestId)?.status === 'submitting'
    )
      return;
    processing.current = true;
    appStore.dispatch(selectPermissionOption(request.requestId, optionId, renderContext));
    processing.current = false;
  }

  // Rebind at each commit so the native listener always sees the current request and props.
  useLayoutEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (
        processing.current ||
        isProcessing ||
        (keyboardShortcutScope &&
          (!keyboardShortcutScope.current?.contains(document.activeElement) ||
            !(event.target instanceof Node) ||
            !keyboardShortcutScope.current.contains(event.target))) ||
        !shouldHandlePermissionShortcut(event, keyboardShortcutsEnabled)
      )
        return;

      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= optionsWithShortcuts.length) {
        event.preventDefault();
        const option = optionsWithShortcuts[num - 1];
        if (option) {
          handleSelectOption(option.id);
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        const denyOption = request.options.find(
          (o) => o.id === 'reject_once' || o.id === 'deny' || o.destructive,
        );
        if (denyOption) {
          handleSelectOption(denyOption.id);
        }
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const transition = createTransition(ref.current, (node) =>
      fly(node, { axis: 'y', distance: 10, tier: 'moderate' }, { direction: 'in' }),
    );
    transition.setPresent(true);
    return () => transition.destroy();
  }, []);

  return (
    <div
      ref={ref}
      aria-busy={isProcessing}
      data-permission-request={request.requestId}
      className="inline-permission-request my-3 rounded-lg border border-border bg-card overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-start gap-3">
          <span className="first-line-icon type-body">
            <span className={cn('p-1.5 rounded-md border', getCategoryColor(display.category))}>
              <IconDefinitionIcon icon={faShieldHalved} className="h-3.5 w-3.5" />
            </span>
          </span>
          <div>
            <div className="type-body font-medium text-foreground">{display.question}</div>
            {request.agentName && (
              <div className="type-caption text-subtle">
                {m.chat_inlinePermission_from_label({ name: request.agentName })}
              </div>
            )}
          </div>
        </div>
        {pendingCount > 1 && (
          <span className="type-caption rounded-full bg-muted px-2 py-0.5 text-subtle">
            {m.chat_inlinePermission_pending_label({ count: formatInteger(pendingCount) })}
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {display.details && (
          <div className="type-code mb-3 overflow-x-auto rounded bg-muted/50 p-2 text-subtle">
            {display.details}
          </div>
        )}

        {request.description && (
          <>
            <Button
              type="button"
              variant="ghost"
              className="type-caption mb-3 flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                const next = !showDetails;
                setShowDetails(next);
                return next;
              }}
            >
              <IconDefinitionIcon
                icon={showDetails ? faChevronDown : faChevronLeft}
                className="text-ui"
              />
              {showDetails
                ? m.chat_inlinePermission_hideRawDetails_label()
                : m.chat_inlinePermission_showRawDetails_label()}
            </Button>

            {showDetails && (
              <div className="type-code mb-3 max-h-32 overflow-x-auto overflow-y-auto rounded bg-muted/30 p-2 text-subtle">
                {request.description}
              </div>
            )}
          </>
        )}

        <div className="flex flex-col gap-2">
          {optionsWithShortcuts.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="plain"
              className={cn(
                'type-body flex items-center gap-3 rounded-md px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                option.destructive
                  ? 'bg-muted text-muted-foreground hover:bg-danger hover:text-danger-background'
                  : 'bg-primary/10 text-foreground hover:bg-primary hover:text-primary-foreground',
              )}
              onClick={() => handleSelectOption(option.id)}
              disabled={isProcessing}
            >
              {option.shortcut && (
                <kbd className="type-caption inline-flex h-5 w-5 items-center justify-center rounded border border-current/30 bg-background/50">
                  {option.shortcut}
                </kbd>
              )}
              <span className="flex-1 text-left">{option.label}</span>
              {option.description && (
                <span className="type-caption text-muted-foreground">{option.description}</span>
              )}
            </Button>
          ))}
        </div>

        {isProcessing && (
          <output className="type-caption mt-2 block text-subtle">
            {m.chat_inlinePermission_submitting_label()}
          </output>
        )}
        {response.value?.status === 'failed' && (
          <p role="alert" className="type-caption mt-2 text-destructive">
            {m.chat_inlinePermission_responseFailed_error()}
          </p>
        )}
        <div className="type-caption mt-2 text-left text-subtle">
          {m.chat_inlinePermission_keyboardHint_label()}
        </div>
      </div>
    </div>
  );
}
