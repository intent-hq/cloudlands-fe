// Source: src/lib/components/ui/MediaLoadingPlaceholder.svelte.
import { useLayoutEffect, useRef } from 'react';
import { ImageIcon } from '@phosphor-icons/react';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import { m } from '$shared/paraglide/messages.js';

export interface MediaLoadingPlaceholderProps {
  name?: string;
}

export function MediaLoadingPlaceholder({ name }: MediaLoadingPlaceholderProps) {
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!text.current) return;
    const observer = truncatedTitle(text.current, name);
    return () => observer?.destroy?.();
  }, [name]);

  return (
    <span
      className="flex min-w-0 max-w-full items-center gap-2 px-2.5 py-2 text-muted-foreground"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source inline media status, not a form-associated output.
      role="status"
      data-testid="media-loading-placeholder"
    >
      <ImageIcon className="size-3.5 shrink-0" weight="regular" aria-hidden="true" />
      <span ref={text} className="type-caption min-w-0 truncate">
        {name || m.ui_mediaLoadingPlaceholder_title_label()}
      </span>
    </span>
  );
}

export default MediaLoadingPlaceholder;
