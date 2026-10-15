import { useState } from 'react';

/** DOM editing buffer: matches the public composer's bindable text while selector emissions coalesce. */
export function useInputText(valueProp: string, onChange?: (value: string) => void) {
  const [draft, setDraft] = useState({ prop: valueProp, value: valueProp });
  let value = draft.value;
  if (draft.prop !== valueProp) {
    value = valueProp;
    setDraft({ prop: valueProp, value: valueProp });
  }
  function updateValue(next: string) {
    setDraft({ prop: valueProp, value: next });
    onChange?.(next);
  }
  return [value, updateValue] as const;
}
