export { toast } from 'svelte-sonner';
export {
  withToastCountdown,
  TOAST_COUNTDOWN_CLASS,
  TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS,
} from './toast-countdown';

export type AgentAttentionToastComponent =
  (typeof import('./AgentAttentionToast.svelte'))['default'];
export type AgentFailureToastComponent = (typeof import('./AgentFailureToast.svelte'))['default'];
export type ErrorToastComponent = (typeof import('./ErrorToast.svelte'))['default'];
export type ToastComponent = (typeof import('./Toast.svelte'))['default'];
export type UpdateToastComponent = (typeof import('./UpdateToast.svelte'))['default'];

export const loadAgentAttentionToast = () =>
  import('./AgentAttentionToast.svelte').then((module) => module.default);
export const loadAgentFailureToast = () =>
  import('./AgentFailureToast.svelte').then((module) => module.default);
export const loadErrorToast = () => import('./ErrorToast.svelte').then((module) => module.default);
export const loadToast = () => import('./Toast.svelte').then((module) => module.default);
export const loadUpdateToast = () =>
  import('./UpdateToast.svelte').then((module) => module.default);
