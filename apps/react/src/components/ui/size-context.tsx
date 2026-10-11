import { createContext, useContext, type ReactNode } from 'react';

export type UiSize = 'default' | 'compact';
const SizeContext = createContext<UiSize>('default');

export function SizeProvider({ size, children }: { size: UiSize; children: ReactNode }) {
  return <SizeContext value={size}>{children}</SizeContext>;
}

export function useSize() {
  return useContext(SizeContext);
}
