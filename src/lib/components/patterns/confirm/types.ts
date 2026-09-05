export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  typedConfirmation?: string;
  onConfirm?: () => void | Promise<void>;
}

export interface PromptField {
  label?: string;
  placeholder?: string;
  initialValue?: string;
  type?: 'text' | 'password' | 'email';
  required?: boolean;
}

export interface PromptOptions extends Omit<ConfirmOptions, 'typedConfirmation' | 'onConfirm'> {
  field: PromptField;
  onConfirm?: (value: string) => void | Promise<void>;
}

export interface AlertOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
}

export type ConfirmResult = boolean;
export type PromptResult = string | null;
