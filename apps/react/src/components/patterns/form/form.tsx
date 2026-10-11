import {
  useRef,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';

type KeyPolicy = 'submit' | 'ignore';

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  busy?: boolean;
  enterKey?: KeyPolicy;
  modEnter?: KeyPolicy;
}

export function Form({
  children,
  onSubmit,
  busy = false,
  enterKey = 'submit',
  modEnter = 'submit',
  className,
  onKeyDown,
  ...props
}: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const submission = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const isBusy = busy || submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submission.current) return;
    submission.current = true;
    setSubmitting(true);
    try {
      await onSubmit(event);
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.defaultPrevented || isBusy)
      return;
    const target = event.target as HTMLElement;
    const multiline = target instanceof HTMLTextAreaElement || target.isContentEditable;
    const interactive = target.closest(
      'button, a[href], select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="slider"]',
    );
    if (interactive && form.current?.contains(interactive)) return;
    if (
      target instanceof HTMLInputElement &&
      !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type)
    )
      return;
    const modified = event.metaKey || event.ctrlKey;
    const shouldSubmit = modified ? modEnter === 'submit' : !multiline && enterKey === 'submit';
    if (shouldSubmit) {
      event.preventDefault();
      form.current?.requestSubmit();
    } else if (!multiline || modified) {
      event.preventDefault();
    }
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Form-level shortcuts handle bubbled events from native controls.
    <form
      ref={form}
      data-slot="form"
      aria-busy={isBusy || undefined}
      className={cn('grid gap-4', className)}
      onSubmit={handleSubmit}
      onKeyDown={onKeyDown ?? handleKeyDown}
      {...props}
    >
      <fieldset className="contents" disabled={isBusy} aria-busy={isBusy || undefined}>
        {children}
      </fieldset>
    </form>
  );
}
