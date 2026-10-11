import type { ComponentProps, ReactNode } from 'react';
import type { UiSize } from '@/components/ui/size-context';

export interface MessageComposerSlotContext {
  openFilePicker: (acceptOverride?: string) => void;
  files: File[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  files: File[];
}

/** React counterpart of the standalone Svelte composer, not the product chat editor. */
export interface MessageComposerProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  size?: UiSize;
  value?: string;
  onValueChange?: (value: string) => void;
  onSend?: (value: string, files: File[], meta?: { queuedId?: string }) => void;
  placeholder?: string;
  leftSlot?: (context: MessageComposerSlotContext) => ReactNode;
  rightSlot?: (context: MessageComposerSlotContext) => ReactNode;
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
    ComponentProps<'textarea'>,
    'value' | 'onInput' | 'onChange' | 'onKeyDown' | 'disabled' | 'placeholder' | 'rows' | 'ref'
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
