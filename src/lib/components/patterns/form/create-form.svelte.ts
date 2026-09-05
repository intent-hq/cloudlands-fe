export type FormErrors<T extends Record<string, unknown>> = Partial<Record<keyof T, string>>;

export interface CreateFormOptions<T extends Record<string, unknown>> {
  initial: T;
  validate?: (values: T) => FormErrors<T> | Promise<FormErrors<T>>;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export function createForm<T extends Record<string, unknown>>({
  initial,
  validate,
}: CreateFormOptions<T>) {
  const initialValues = copy(initial);
  let values = $state(copy(initialValues));
  let errors = $state<FormErrors<T>>({});
  let submitting = $state(false);
  const dirty = $derived(JSON.stringify(values) !== JSON.stringify(initialValues));

  async function submit(onValid?: (values: T) => void | Promise<void>): Promise<boolean> {
    if (submitting) return false;
    submitting = true;
    try {
      errors = validate ? await validate(values) : {};
      if (Object.keys(errors).length > 0) return false;
      await onValid?.(values);
      return true;
    } finally {
      submitting = false;
    }
  }

  function reset(): void {
    values = copy(initialValues);
    errors = {};
  }

  return {
    get values() {
      return values;
    },
    get errors() {
      return errors;
    },
    get dirty() {
      return dirty;
    },
    get submitting() {
      return submitting;
    },
    submit,
    reset,
  };
}
