export { toast } from 'sonner';
export type { ExternalToast } from 'sonner';
export { Toast, type ToastProps } from './toast';
export { AgentAttentionToast, type AgentAttentionToastProps } from './agent-attention-toast';
export { AgentFailureToast, type AgentFailureToastProps } from './agent-failure-toast';
export { ErrorToast, type ErrorToastProps } from './error-toast';
export { UpdateToast, type UpdateToastProps, type UpdateToastPreviewState } from './update-toast';
export { ToastCloseButton, type ToastCloseButtonProps } from './toast-close-button';
export { ToastGlyph, type ToastGlyphVariant } from './toast-glyph';
export { ToastUndoAction } from './toast-undo-action';
export {
  withToastCountdown,
  TOAST_COUNTDOWN_CLASS,
  TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS,
} from './toast-countdown';

export type AgentAttentionToastComponent =
  (typeof import('./agent-attention-toast'))['AgentAttentionToast'];
export type AgentFailureToastComponent =
  (typeof import('./agent-failure-toast'))['AgentFailureToast'];
export type ErrorToastComponent = (typeof import('./error-toast'))['ErrorToast'];
export type ToastComponent = (typeof import('./toast'))['Toast'];
export type UpdateToastComponent = (typeof import('./update-toast'))['UpdateToast'];

export const loadAgentAttentionToast = () =>
  import('./agent-attention-toast').then((module) => module.AgentAttentionToast);
export const loadAgentFailureToast = () =>
  import('./agent-failure-toast').then((module) => module.AgentFailureToast);
export const loadErrorToast = () => import('./error-toast').then((module) => module.ErrorToast);
export const loadToast = () => import('./toast').then((module) => module.Toast);
export const loadUpdateToast = () => import('./update-toast').then((module) => module.UpdateToast);
export { toastMetadata } from '$lib/components/ui/toast/toast.meta';
