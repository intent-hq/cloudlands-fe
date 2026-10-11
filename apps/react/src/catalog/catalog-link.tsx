import { useNavigate } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

/** Preserve ordinary anchor behavior and use the app router for same-window navigation. */
export function CatalogLink({
  href = '/sandbox',
  onClick,
  children,
  ...props
}: ComponentProps<'a'>) {
  const navigate = useNavigate();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          props.target ||
          props.download
        )
          return;
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        event.preventDefault();
        void navigate({
          to: url.pathname,
          search: Object.fromEntries(url.searchParams),
          hash: url.hash.slice(1),
        });
      }}
    >
      {children}
    </a>
  );
}
