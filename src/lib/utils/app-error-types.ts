import type { SvelteErrorInfo } from './svelte-error-resolver';

export interface AppError {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  stack?: string;
  recoverable: boolean;
  action?: {
    label: string;
    handler: () => void | Promise<void>;
  };
  // Enhanced Svelte error information
  svelteError?: SvelteErrorInfo;
  // Human-readable formatted message (includes debugging tips for Svelte errors)
  formattedMessage?: string;
}
