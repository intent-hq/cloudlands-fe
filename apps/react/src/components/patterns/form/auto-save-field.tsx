import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/utils';
import type { SaveStatus } from '$lib/components/patterns/form/types';
import { UnsavedIndicator } from './unsaved-indicator';

export interface AutoSaveControl<T> {
  value: T;
  update: (value: T) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  disabled: boolean;
  status: SaveStatus;
}

export interface AutoSaveFieldHandle {
  flush: () => void;
}

export interface AutoSaveFieldProps<T> {
  value: T;
  originalValue?: T;
  onSave: (value: T) => void | Promise<void>;
  children: (control: AutoSaveControl<T>) => ReactNode;
  debounceMs?: number;
  savedFlashMs?: number;
  disabled?: boolean;
  canSave?: (value: T) => boolean;
  prepare?: (value: T) => T;
  equals?: (left: T, right: T) => boolean;
  statusLabel?: (status: SaveStatus) => string | undefined;
  className?: string;
  ref?: Ref<AutoSaveFieldHandle>;
}

const alwaysValid = () => true;
const identity = <T,>(value: T): T => value;

export function AutoSaveField<T>({
  value,
  originalValue,
  onSave,
  children,
  debounceMs = 1000,
  savedFlashMs = 2000,
  disabled = false,
  canSave = alwaysValid,
  prepare = identity,
  equals = Object.is,
  statusLabel,
  className,
  ref,
}: AutoSaveFieldProps<T>) {
  const [initialValue] = useState(() => value);
  const [localValue, setLocalValue] = useState<T>(() => value);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const state = useRef({
    value,
    status: 'idle' as SaveStatus,
    focused: false,
    lastPropValue: value,
  });
  const options = useRef({
    originalValue: originalValue === undefined ? initialValue : originalValue,
    onSave,
    debounceMs,
    savedFlashMs,
    disabled,
    canSave,
    prepare,
    equals,
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    options.current = {
      originalValue: originalValue === undefined ? initialValue : originalValue,
      onSave,
      debounceMs,
      savedFlashMs,
      disabled,
      canSave,
      prepare,
      equals,
    };
    if (!equals(value, state.current.lastPropValue)) {
      state.current.lastPropValue = value;
      if (!state.current.focused) {
        state.current.value = value;
        state.current.status = 'idle';
        setLocalValue(() => value);
        setStatus('idle');
      }
    }
  }, [
    value,
    originalValue,
    initialValue,
    onSave,
    debounceMs,
    savedFlashMs,
    disabled,
    canSave,
    prepare,
    equals,
  ]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(debounceTimer.current);
      clearTimeout(savedTimer.current);
    };
  }, []);

  function changeStatus(next: SaveStatus) {
    state.current.status = next;
    if (mounted.current) setStatus(next);
  }

  function dirty() {
    return !options.current.equals(state.current.value, options.current.originalValue);
  }

  function clearDebounce() {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = undefined;
  }

  async function save() {
    const current = options.current;
    if (
      current.disabled ||
      !dirty() ||
      !current.canSave(state.current.value) ||
      state.current.status === 'saving'
    )
      return;
    changeStatus('saving');
    try {
      await current.onSave(current.prepare(state.current.value));
      if (!mounted.current) return;
      changeStatus('saved');
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(
        () => changeStatus(dirty() ? 'unsaved' : 'idle'),
        options.current.savedFlashMs,
      );
    } catch {
      if (mounted.current) changeStatus('error');
    }
  }

  function update(next: T) {
    state.current.value = next;
    setLocalValue(() => next);
    changeStatus(dirty() ? 'unsaved' : 'idle');
    clearDebounce();
    if (!options.current.disabled && options.current.canSave(next) && dirty()) {
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = undefined;
        void save();
      }, options.current.debounceMs);
    }
  }

  function flush() {
    if (debounceTimer.current === undefined) return;
    clearDebounce();
    void save();
  }

  useImperativeHandle(ref, () => ({ flush }));

  return (
    <div data-slot="auto-save-field" data-state={status} className={cn('relative', className)}>
      {/* oxlint-disable-next-line react/refs -- The render prop receives callbacks; only those event handlers access refs. */}
      {children({
        value: localValue,
        update,
        onFocus: () => {
          state.current.focused = true;
        },
        onBlur: () => {
          flush();
          state.current.focused = false;
        },
        onKeyDown: (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            clearDebounce();
            void save();
          }
        },
        disabled,
        status,
      })}
      <UnsavedIndicator
        status={status}
        label={statusLabel?.(status)}
        className="absolute right-3 top-2.5"
      />
    </div>
  );
}
