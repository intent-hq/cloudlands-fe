import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faXmark } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

export interface HomeSearchProps {
  value: string;
  onchange: (value: string) => void;
  placeholder: string;
  label?: string;
  className?: string;
  inputClass?: string;
}

export function HomeSearch({
  value,
  onchange,
  placeholder,
  label = placeholder,
  className = '',
  inputClass = '',
}: HomeSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const [inputState, setInputState] = useState({ externalValue: value, displayedValue: value });
  if (inputState.externalValue !== value) {
    setInputState({ externalValue: value, displayedValue: value });
  }
  function clear() {
    onchange('');
    input.current?.focus();
  }
  return (
    <div className={`relative min-w-0 ${className}`}>
      <Input
        ref={input}
        type="search"
        value={inputState.displayedValue}
        placeholder={placeholder}
        aria-label={label}
        className={`pr-9 [&::-webkit-search-cancel-button]:appearance-none ${inputClass}`}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setInputState({ externalValue: value, displayedValue: nextValue });
          onchange(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            clear();
          }
        }}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          aria-label={m.chat_modelPicker_clearSearch_ariaLabel()}
          onClick={clear}
        >
          <IconDefinitionIcon icon={faXmark} />
        </Button>
      )}
    </div>
  );
}
