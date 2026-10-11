import { useRef, useState } from 'react';

export type FormErrors<T extends Record<string, unknown>> = Partial<Record<keyof T, string>>;

export interface CreateFormOptions<T extends Record<string, unknown>> {
  initial: T;
  validate?: (values: T) => FormErrors<T> | Promise<FormErrors<T>>;
}

export function useForm<T extends Record<string, unknown>>({
  initial,
  validate,
}: CreateFormOptions<T>) {
  const [initialValues] = useState(() => structuredClone(initial));
  const [values, updateValues] = useState(() => structuredClone(initialValues));
  const [errors, setErrors] = useState<FormErrors<T>>({});
  const [submitting, setSubmitting] = useState(false);
  const currentValues = useRef(values);
  const pending = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  function setValues(next: T | ((previous: T) => T)) {
    const updated = typeof next === 'function' ? next(currentValues.current) : next;
    currentValues.current = updated;
    updateValues(updated);
  }

  function setField<K extends keyof T>(key: K, value: T[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(onValid?: (values: T) => void | Promise<void>): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setSubmitting(true);
    try {
      const nextErrors = validate ? await validate(currentValues.current) : {};
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) return false;
      await onValid?.(currentValues.current);
      return true;
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  function reset() {
    setValues(structuredClone(initialValues));
    setErrors({});
  }

  return { values, errors, dirty, submitting, setValues, setField, submit, reset };
}
