// Source: src/lib/components/chat/input/ModelPickerProviderNotice.svelte.
import type { MouseEvent } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { cn } from '@/lib/utils';
import { openExternalUrl } from '$lib/utils/open-external';
import { m } from '$shared/paraglide/messages.js';

export interface ModelPickerProviderNoticeProps {
  warning?: string;
  docsUrl?: string;
  show: boolean;
  title?: string;
  description?: string;
  linkText?: string;
  variant?: 'warning' | 'progress';
  /** Source `class`, renamed for React. */
  className?: string;
}

export function ModelPickerProviderNotice({
  warning,
  docsUrl,
  show,
  title = m.chat_modelPicker_defaultModelList_title(),
  description = m.chat_modelPicker_installCodex_description(),
  linkText = m.chat_modelPicker_setupDocs_label(),
  variant = 'warning',
  className,
}: ModelPickerProviderNoticeProps) {
  if (!show || (!warning && variant !== 'progress')) return null;

  async function openDocs(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    // The Svelte shell:openExternal handler converges on this safe opener too.
    if (docsUrl) await openExternalUrl(docsUrl);
  }

  return (
    <div
      className={cn(
        'type-caption max-w-[360px] rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-foreground',
        className,
      )}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source live status region containing provider guidance and a docs link.
      role="status"
    >
      <div className="flex items-start gap-2">
        {variant === 'progress' ? (
          <IntentMarkLoader size={14} className="text-warning-ink mt-0.5 shrink-0" />
        ) : (
          <WarningIcon
            weight="regular"
            className="h-3.5 w-3.5 text-warning-ink mt-0.5 shrink-0"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 leading-snug">
          <div className="font-medium">{title}</div>
          <div className="text-subtle">
            {description}
            {docsUrl && (
              <>
                {' '}
                <a
                  href={docsUrl}
                  onClick={openDocs}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {linkText}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
