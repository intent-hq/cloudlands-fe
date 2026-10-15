import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';
export const Route = createFileRoute('/workspace')({
  ssr: false,
  component: lazy(
    createClientOnlyFn(async () => ({
      default: (await import('@/features/desktop/desktop-shell')).DesktopShell,
    })),
  ),
});
