// Source: src/lib/components/chat/SetupScriptCard.svelte.
import { useState } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { faTerminal, faCopy, faCheck } from '$lib/icons/phosphor-icon-definitions';
import { COPY_FEEDBACK_RESET_MS } from '$lib/motion/copy-feedback-timing';
import { m } from '$shared/paraglide/messages.js';

export interface SetupScriptCardProps {
  name: string;
  description: string;
  content: string;
  onUseScript?: (script: { name: string; description: string; content: string }) => void;
}

export function SetupScriptCard({ name, description, content, onUseScript }: SetupScriptCardProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    // Preserve source feedback: do not await the write or cancel earlier reset timers.
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, COPY_FEEDBACK_RESET_MS);
  }

  function handleUse() {
    onUseScript?.({ name, description, content });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-muted/30 border border-border rounded-lg my-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="shrink-0 text-subtle">
            <IconDefinitionIcon icon={faTerminal} size="0.875em" />
          </div>
          <div className="font-medium text-sm">{name}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost-light" size="sm" onClick={handleCopy} className="h-7 px-2">
            <IconDefinitionIcon icon={copied ? faCheck : faCopy} className="mr-1" />
            {copied ? m.chat_shared_copied_label() : m.chat_shared_copy_label()}
          </Button>
          {onUseScript && (
            <Button variant="ghost-light" size="sm" onClick={handleUse} className="h-7 px-2">
              {m.chat_setupScriptCard_useScript_label()}
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-subtle">{description}</div>
      <pre className="text-xs bg-background/50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto font-mono">
        {content}
      </pre>
    </div>
  );
}
