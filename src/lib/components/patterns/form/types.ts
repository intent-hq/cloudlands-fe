export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export interface FormControlProps {
  id: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface AutoSaveControl<T> {
  value: T;
  update: (value: T) => void;
  onfocus: () => void;
  onblur: () => void;
  onkeydown: (event: KeyboardEvent) => void;
  disabled: boolean;
  status: SaveStatus;
}
