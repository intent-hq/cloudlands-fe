import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';

export const Route = createFileRoute('/workspaces/')({
  ssr: false,
  component: lazy(
    createClientOnlyFn(async () => ({
      default: (await import('@/features/workspace/workspace-overview')).WorkspaceList,
    })),
  ),
});
