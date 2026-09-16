import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ContextImagesSection from './ContextImagesSection.svelte';

// i18n-ignore (sandbox fixture images and names)
const images = ['Landscape', 'Portrait', 'Diagram', 'Reference'].map((name, index) => ({
  id: `image-${index}`,
  name: `${name}.svg`,
  block: {
    type: 'image' as const,
    mimeType: 'image/svg+xml',
    data: btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="${index === 1 ? 360 : 180}" viewBox="0 0 240 180"><rect width="240" height="180" fill="${['#dbeafe', '#fef3c7', '#d1fae5', '#ede9fe'][index]}"/><circle cx="170" cy="48" r="23" fill="#fbbf24"/><path d="M0 180L82 55L155 144L197 96L240 180Z" fill="#475569"/></svg>`,
    ),
  },
}));

export const preview = definePreview<ComponentProps<typeof ContextImagesSection>>({
  id: 'context-images',
  title: 'Context images',
  defaultState: 'grid',
  states: {
    grid: { props: { workspaceId: 'preview-workspace', images } },
    empty: { props: { workspaceId: 'preview-workspace', images: [] } },
  },
});

export default ContextImagesSection;
