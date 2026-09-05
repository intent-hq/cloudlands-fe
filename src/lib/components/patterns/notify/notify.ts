import type { Component, ComponentProps } from 'svelte';
import { toast, type ExternalToast } from 'svelte-sonner';
import {
  loadAgentFailureToast,
  loadErrorToast,
  loadUpdateToast,
  withToastCountdown,
  type AgentFailureToastComponent,
  type ErrorToastComponent,
  type UpdateToastComponent,
} from '$lib/components/ui/toast';
import NotifyErrorToast from './NotifyErrorToast.svelte';

type AnyComponent = Component<any, any, string>;

export type NotifyId = string | number;
export type NotifyError = Error | { message: string; details?: string };
export type NotifyOptions<T extends AnyComponent = AnyComponent> = ExternalToast<T> & {
  key?: string;
};
export type AgentFailureNotifyProps = ComponentProps<AgentFailureToastComponent>;
export type AppErrorNotifyProps = ComponentProps<ErrorToastComponent>;
export type UpdateNotifyProps = ComponentProps<UpdateToastComponent>;

export const NOTIFY_DURATION = {
  success: 2_000,
  info: 5_000,
  warning: 10_000,
  error: 15_000,
  custom: 10_000,
  undoable: 10_000,
  progress: Number.POSITIVE_INFINITY,
} as const;

type NotifyKind = keyof typeof NOTIFY_DURATION;

export interface ProgressHandle {
  readonly id: NotifyId;
  update(message: string, options?: NotifyOptions): void;
  success(message: string, options?: NotifyOptions): void;
  error(error: string | NotifyError, options?: NotifyOptions): void;
  dismiss(): void;
}

export interface UndoableOptions extends NotifyOptions {
  undoLabel: string;
  onUndo: () => void | Promise<void>;
  onExpire?: () => void | Promise<void>;
}

const undoTimers = new Map<NotifyId, ReturnType<typeof setTimeout>>();
let lazyToastSequence = 0;

function withPolicy<T extends AnyComponent>(
  kind: NotifyKind,
  options: NotifyOptions<T> = {},
): ExternalToast<T> {
  const { key, ...sonnerOptions } = options;
  return {
    duration: NOTIFY_DURATION[kind],
    ...sonnerOptions,
    id: key ?? sonnerOptions.id,
  };
}

function errorDetails(error: NotifyError): { message: string; details?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      details: error.stack ?? `${error.name}: ${error.message}`,
    };
  }
  return error;
}

function showError(error: string | NotifyError, options: NotifyOptions = {}): NotifyId {
  if (typeof error === 'string') {
    return toast.error(error, withPolicy('error', options));
  }
  const normalized = errorDetails(error);
  if (!normalized.details) {
    return toast.error(normalized.message, withPolicy('error', options));
  }
  const customOptions = withPolicy('error', options);
  return toast.custom(NotifyErrorToast, {
    ...customOptions,
    class: customOptions.class
      ? `${customOptions.class} !border-destructive/50`
      : '!border-destructive/50',
    componentProps: normalized as ComponentProps<typeof NotifyErrorToast>,
  });
}

function dismiss(id?: NotifyId | ProgressHandle) {
  return toast.dismiss(typeof id === 'object' ? id.id : id);
}

function progress(message: string, options: NotifyOptions = {}): ProgressHandle {
  const id = toast.loading(message, withPolicy('progress', options));
  return {
    id,
    update(nextMessage, nextOptions = {}) {
      toast.loading(nextMessage, withPolicy('progress', { ...nextOptions, id }));
    },
    success(nextMessage, nextOptions = {}) {
      toast.success(nextMessage, withPolicy('success', { ...nextOptions, id }));
    },
    error(nextError, nextOptions = {}) {
      showError(nextError, { ...nextOptions, id });
    },
    dismiss() {
      toast.dismiss(id);
    },
  };
}

function undoable(message: string, options: UndoableOptions): NotifyId {
  const { undoLabel, onUndo, onExpire, ...notifyOptions } = options;
  const shaped = withPolicy('undoable', notifyOptions);
  const duration = shaped.duration ?? NOTIFY_DURATION.undoable;
  let id = shaped.id;
  const previousTimer = id === undefined ? undefined : undoTimers.get(id);
  if (previousTimer) clearTimeout(previousTimer);

  let settled = false;
  const settle = () => {
    settled = true;
    if (id === undefined) return;
    const timer = undoTimers.get(id);
    if (timer) clearTimeout(timer);
    undoTimers.delete(id);
  };
  const handleUndo = async () => {
    settle();
    try {
      await onUndo();
      if (id !== undefined) toast.dismiss(id);
    } catch (error) {
      showError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  id = toast.warning(
    message,
    withToastCountdown(
      {
        ...shaped,
        action: { label: undoLabel, onClick: handleUndo },
      },
      { pauseOnHover: false },
    ),
  );

  if (onExpire && Number.isFinite(duration) && duration > 0) {
    undoTimers.set(
      id,
      setTimeout(() => {
        if (settled) return;
        settle();
        void onExpire();
      }, duration),
    );
  }

  return id;
}

function custom<T extends AnyComponent>(component: T, options: NotifyOptions<T> = {}): NotifyId {
  return toast.custom(component, withPolicy('custom', options));
}

function lazyCustom<T extends AnyComponent>(
  loadComponent: () => Promise<T>,
  props: ComponentProps<T>,
  options: NotifyOptions<T> = {},
): NotifyId {
  const id = options.key ?? options.id ?? `notify:custom:${++lazyToastSequence}`;
  void loadComponent().then((component) => {
    custom(component, { ...options, id, componentProps: props });
  });
  return id;
}

export const notify = {
  success: (message: string, options?: NotifyOptions) =>
    toast.success(message, withPolicy('success', options)),
  info: (message: string, options?: NotifyOptions) =>
    toast.info(message, withPolicy('info', options)),
  warning: (message: string, options?: NotifyOptions) =>
    toast.warning(message, withPolicy('warning', options)),
  error: showError,
  progress,
  undoable,
  custom,
  dismiss,
  agentFailure: (
    props: AgentFailureNotifyProps,
    options?: NotifyOptions<AgentFailureToastComponent>,
  ) => lazyCustom(loadAgentFailureToast, props, options),
  appError: (props: AppErrorNotifyProps, options?: NotifyOptions<ErrorToastComponent>) =>
    lazyCustom(loadErrorToast, props, options),
  update: (props: UpdateNotifyProps, options?: NotifyOptions<UpdateToastComponent>) =>
    lazyCustom(loadUpdateToast, props, options),
};
