import type { Snippet } from 'svelte';
import type { HTMLAttributes, HTMLTextareaAttributes } from 'svelte/elements';
import type { UiSize } from '$lib/components/ui/size-context';

export interface MessageComposerSlotContext {
  openFilePicker: (acceptOverride?: string) => void;
  files: File[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  files: File[];
}

export interface MessageComposerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onchange'> {
  size?: UiSize;
  value?: string;
  onValueChange?: (value: string) => void;
  onSend?: (value: string, files: File[], meta?: { queuedId?: string }) => void;
  placeholder?: string;
  leftSlot?: Snippet<[MessageComposerSlotContext]>;
  rightSlot?: Snippet<[MessageComposerSlotContext]>;
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  clickToFocus?: boolean;
  sendLabel?: string;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  accept?: string;
  maxFiles?: number;
  filePreviewSize?: number;
  textareaProps?: Omit<
    HTMLTextareaAttributes,
    'value' | 'oninput' | 'onkeydown' | 'disabled' | 'placeholder' | 'rows'
  >;
  status?: 'idle' | 'streaming';
  onStop?: () => void;
  queue?: QueuedMessage[];
  onQueueChange?: (queue: QueuedMessage[]) => void;
  showQueue?: boolean;
  history?: string[];
  placeholderSuggestion?: string;
  suggestions?: string[];
}
