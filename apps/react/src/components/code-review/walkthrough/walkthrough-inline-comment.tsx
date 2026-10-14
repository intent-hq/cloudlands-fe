import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { faArrowRight } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

export interface WalkthroughInlineCommentProps {
  lineNumber?: number;
  fileName?: string;
  onSend?: (message: string, lineNumber: number, fileName: string) => void;
  onClose?: () => void;
  isSending?: boolean;
  className?: string;
}

export function WalkthroughInlineComment({
  lineNumber = 0,
  fileName = '',
  onSend,
  onClose,
  isSending = false,
  className = '',
}: WalkthroughInlineCommentProps) {
  const [message, setMessage] = useState('');
  const inputElement = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputElement.current?.focus();
  }, []);

  function handleSend() {
    if (!message.trim() || isSending) return;
    onSend?.(message.trim(), lineNumber, fileName);
    setMessage('');
  }

  function handleKeydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
    if (event.key === 'Escape') onClose?.();
  }

  return (
    <>
      <div className={`walkthrough-inline-comment flex items-center gap-2 ${className}`}>
        <Input
          ref={inputElement}
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={handleKeydown}
          placeholder={m.codeReview_inlineComment_askLine_placeholder()}
          disabled={isSending}
          className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50"
        />
        <Button
          type="button"
          variant="primary"
          onClick={handleSend}
          disabled={!message.trim() || isSending}
          className="h-8 w-8 p-0"
        >
          {isSending ? (
            <IntentMarkLoader size={14} />
          ) : (
            <IconDefinitionIcon icon={faArrowRight} className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onClose?.()}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {m.codeReview_inlineComment_cancel_label()}
        </Button>
      </div>
      <p className="text-ui text-subtle mt-1">{m.codeReview_inlineComment_inputHint_label()}</p>
    </>
  );
}
