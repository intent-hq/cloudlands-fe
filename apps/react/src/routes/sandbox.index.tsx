import { createFileRoute } from '@tanstack/react-router';
import { createClientOnlyFn } from '@tanstack/react-start';
import { lazy } from 'react';

export const Route = createFileRoute('/sandbox/')({
  ssr: false,
  component: lazy(
    createClientOnlyFn(async () => ({
      default: (await import('@/catalog/catalog-app')).CatalogApp,
    })),
  ),
});
