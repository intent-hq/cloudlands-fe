import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ContextAttachmentsSection from './ContextAttachmentsSection.svelte';

// i18n-ignore (sandbox fixture images and names)
const attachments = ['Landscape', 'Portrait', 'Diagram', 'Reference'].map((name, index) => ({
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

export const preview = definePreview<ComponentProps<typeof ContextAttachmentsSection>>({
  id: 'context-attachments',
  title: 'Context attachments',
  defaultState: 'grid',
  states: {
    grid: { props: { workspaceId: 'preview-workspace', attachments } },
    mixed: {
      props: {
        workspaceId: 'preview-workspace',
        attachments: [
          attachments[0],
          {
            id: 'pdf',
            name: 'Design brief.pdf',
            block: {
              type: 'file',
              attachmentId: 'pdf',
              fileName: 'Design brief.pdf',
              mimeType: 'application/pdf',
            },
          },
          {
            id: 'video',
            name: 'Walkthrough.mp4',
            block: {
              type: 'file',
              attachmentId: 'video',
              fileName: 'Walkthrough.mp4',
              mimeType: 'video/mp4',
            },
          },
          {
            id: 'archive',
            name: 'Assets.zip',
            block: {
              type: 'file',
              attachmentId: 'archive',
              fileName: 'Assets.zip',
              mimeType: 'application/zip',
            },
          },
          {
            id: 'uploading',
            name: 'Recording.webm',
            placementStatus: 'placing',
            block: { type: 'file', fileName: 'Recording.webm', mimeType: 'video/webm' },
          },
          {
            id: 'failed',
            name: 'Report.pdf',
            placementStatus: 'failed',
            block: { type: 'file', fileName: 'Report.pdf', mimeType: 'application/pdf' },
          },
        ],
      },
    },
    empty: { props: { workspaceId: 'preview-workspace', attachments: [] } },
  },
});

export default ContextAttachmentsSection;
