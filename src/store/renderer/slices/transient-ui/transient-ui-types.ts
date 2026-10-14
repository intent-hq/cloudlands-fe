import type { ContextItem } from '$lib/components/chat/input/context-item';

/** Browser File handles stay with the composer, outside Redux. */
export type ComposerContextItem = Omit<ContextItem, 'file'>;
