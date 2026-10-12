// Source: src/lib/components/chat/ProviderRehomedNotice.svelte.
import { ArrowsLeftRightIcon } from '@phosphor-icons/react';
import { useSignals } from '@preact/signals-react/runtime';
import { m } from '$shared/paraglide/messages.js';
import {
  formatProviderRehomedLabel,
  type ProviderRehomedNoticeInfo,
} from '$lib/components/chat/rehome-notice-core';
import { noticeDisplayNameReads } from './notice-display-name-reads';

export type { ProviderRehomedNoticeInfo } from '$lib/components/chat/rehome-notice-core';

export interface ProviderRehomedNoticeProps {
  workspaceId?: string;
  notice: ProviderRehomedNoticeInfo;
  /** Fallback text (the daemon's message content) when the metadata fields are absent. */
  fallbackText?: string;
}

export function ProviderRehomedNotice({
  notice,
  workspaceId,
  fallbackText = m.chat_providerRehomedNotice_fallback_label(),
}: ProviderRehomedNoticeProps) {
  // The shared formatter reads signals through callbacks, beyond automatic transform tracking.
  useSignals();
  const label = formatProviderRehomedLabel(
    notice,
    fallbackText,
    workspaceId,
    noticeDisplayNameReads,
  );

  return (
    <div
      className="provider-rehomed-notice my-4 flex w-full min-w-0 items-center gap-3"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source transcript live status region.
      role="status"
    >
      <div className="h-px min-w-4 flex-1 bg-border" />
      <span className="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
        <ArrowsLeftRightIcon
          weight="regular"
          className="mt-0.5 h-3 w-3 flex-shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">{label}</span>
      </span>
      <div className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}
