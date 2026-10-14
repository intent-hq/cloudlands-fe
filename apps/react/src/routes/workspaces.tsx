import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';
import { WorkspaceRouteLoading } from '@/features/workspace/workspace-content-loading';

export const Route = createFileRoute('/workspaces')({
  ssr: false,
  pendingComponent: WorkspaceRouteLoading,
  component: lazy(
    createClientOnlyFn(async () => ({
      default: (await import('@/features/workspace/workspace-shell')).WorkspaceShell,
    })),
  ),
});
