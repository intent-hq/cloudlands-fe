import { signal } from '@preact/signals-react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

it('renders typed JSX and reacts to signal writes through the configured transform', async () => {
  const previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT',
  );
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });
  const count = signal<number>(2);
  function Counter({ label }: { label: string }) {
    return <output aria-label={label}>{count.value}</output>;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Counter label="Counter" />);
    });
    expect(container.querySelector('output')?.textContent).toBe('2');
    await act(async () => {
      count.value = 7;
    });
    expect(container.querySelector('output')?.textContent).toBe('7');
  } finally {
    try {
      await act(async () => {
        root.unmount();
      });
    } finally {
      container.remove();
      if (previousActEnvironment) {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
      } else {
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      }
    }
  }
});
