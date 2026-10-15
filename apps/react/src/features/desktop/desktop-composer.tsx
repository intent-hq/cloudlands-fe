import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useInputText } from '@/lib/use-input-text';
import { ArrowUpIcon, PlusIcon, SquareIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ContentDialog } from '@/components/patterns/confirm/content-dialog';
import type { MessageComposerProps } from '@/components/ui/message-composer';
import { getEffectiveShortcut } from '@/lib/effective-shortcuts';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { isMacPlatform } from '$lib/utils/shortcuts';
import { m } from '$shared/paraglide/messages.js';

/** Source SimpleRichInput edge-docked ordinary text surface. Submission stays in its host. */
export function DesktopComposer({
  value: valueProp = '',
  onValueChange,
  onSend,
  onStop,
  onEnqueue,
  enqueueDisabled,
  sendDisabled,
  disabled,
  status,
  leftSlot,
  rightSlot,
  hasAttachments,
}: MessageComposerProps) {
  const [value, editValue] = useInputText(valueProp, onValueChange);
  const input = useRef<HTMLTextAreaElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
  // SimpleRichInput owns these as DOM-local geometry, not persisted draft/domain state.
  const tall = panelHeight !== null && panelHeight > 640;
  const minimum = value.trim() || hasAttachments ? (tall ? 100 : 65) : tall ? 80 : 56;
  const maximum = panelHeight ? Math.min(Math.floor(panelHeight * 0.8), 800) : 300;
  useLayoutEffect(() => {
    const panel = container.current?.closest('.desktop-conversation');
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => setPanelHeight(entry.contentRect.height));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => () => resizeCleanup.current?.(), []);
  function beginResize(event: ReactMouseEvent<HTMLButtonElement>) {
    const node = container.current;
    if (!node || event.button !== 0 || node.closest('[hidden],[inert]')) return;
    resizeCleanup.current?.();
    event.preventDefault();
    const initialY = event.clientY,
      initialHeight = node.offsetHeight;
    setResizing(true);
    const finish = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
      observer.disconnect();
      resizeCleanup.current = null;
      setResizing(false);
    };
    const current = () => node.isConnected && !node.closest('[hidden],[inert]');
    const move = (next: MouseEvent) => {
      if (!current()) {
        finish();
        return;
      }
      setManualHeight(Math.max(65, Math.min(800, initialHeight + initialY - next.clientY)));
    };
    const observer = new MutationObserver(() => {
      if (!current()) finish();
    });
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement)
      observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert'] });
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', finish);
    window.addEventListener('blur', finish);
    resizeCleanup.current = finish;
  }
  const [more, setMore] = useState(false);
  const [focused, setFocused] = useState(false);
  const responding = status === 'streaming';
  const stop = responding && !value.trim() && !hasAttachments;
  const queue = responding && !stop;
  const blocked =
    disabled ||
    (!stop && (sendDisabled || (!value.trim() && !hasAttachments) || (queue && enqueueDisabled)));
  const label = stop
    ? m.chat_richInput_stopStreaming_ariaLabel()
    : queue
      ? m.chat_richInput_queueMessage_ariaLabel()
      : m.chat_richInput_sendMessage_ariaLabel();
  const slots = { files: [], openFilePicker: () => setMore(true) };
  function submit() {
    if (blocked) return;
    if (stop) onStop?.();
    else if (queue) onEnqueue?.(value.trim());
    else onSend?.(value.trim(), []);
  }
  return (
    <>
      <div
        ref={container}
        className="desktop-text-composer"
        data-testid="desktop-text-composer"
        data-manual-height={manualHeight !== null}
        style={
          manualHeight === null
            ? { minHeight: minimum, maxHeight: maximum }
            : { height: manualHeight, minHeight: 65 }
        }
      >
        <Button
          variant="plain"
          wrapContent={false}
          className="app-resize-handle desktop-composer-resize"
          data-resize-axis="y"
          data-resize-indicator="short"
          data-resizing={resizing}
          aria-label={m.chat_richInput_resize_ariaLabel()}
          tabIndex={-1}
          onMouseDown={beginResize}
          onDoubleClick={() => {
            resizeCleanup.current?.();
            setManualHeight(null);
          }}
        />
        <Textarea
          ref={input}
          value={value}
          onChange={(event) => editValue(event.target.value)}
          rows={1}
          autoResize={manualHeight === null}
          minHeight={32}
          maxHeight={Math.max(32, maximum - 51)}
          style={
            manualHeight === null
              ? undefined
              : { height: 0, minHeight: 0, maxHeight: 'none', overflowY: 'auto' }
          }
          noFocusStyle
          disabled={disabled}
          className="desktop-composer-input"
          placeholder={focused ? m.chat_richInput_askAnything_placeholder() : ''}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={m.chat_richInput_askAnything_placeholder()}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.defaultPrevented ||
              !matchesShortcut(
                event.nativeEvent,
                getEffectiveShortcut('chat.send'),
                isMacPlatform(),
              )
            )
              return;
            event.preventDefault();
            // An empty Enter never stops a response. Stop remains an explicit button action.
            if (!stop) submit();
          }}
        />
        <div className="desktop-composer-actions">
          <div className="min-w-0 flex-1">{leftSlot?.(slots)}</div>
          {rightSlot?.(slots)}
          <Button
            variant="ghost-light"
            size="icon-sm"
            disabled={disabled}
            className="desktop-composer-more"
            aria-label={m.ui_breadcrumb_more_label()}
            onClick={() => setMore(true)}
          >
            <PlusIcon size={16} />
          </Button>
          <Button
            variant="primary"
            size="icon-sm"
            className="desktop-composer-submit"
            disabled={blocked}
            aria-label={label}
            onClick={submit}
          >
            {stop ? (
              <SquareIcon size={12} weight="fill" />
            ) : (
              <ArrowUpIcon size={19} weight="regular" />
            )}
          </Button>
        </div>
      </div>
      <ContentDialog
        open={more}
        onOpenChange={setMore}
        title={m.ui_breadcrumb_more_label()}
        description={m.desktop_shell_unported_description()}
      />
    </>
  );
}
