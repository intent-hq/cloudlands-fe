import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Type utilities for component props
export type WithElementRef<T, E = HTMLElement> = T & {
  ref?: E | null;
};

export type WithoutChildrenOrChild<T> = Omit<T, 'children' | 'child'>;

// Aliases for common usage
export type WithoutChild<T> = WithoutChildrenOrChild<T>;
export type WithoutChildren<T> = WithoutChildrenOrChild<T>;
