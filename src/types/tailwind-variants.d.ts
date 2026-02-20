declare module 'tailwind-variants' {
  // Minimal typing shim to make `tv` and `VariantProps` available without
  // pulling in complex upstream types that currently conflict with our setup.
  // This keeps our UI components type-safe enough for usage while avoiding
  // noisy module resolution issues.
  export function tv(...args: any[]): (...args: any[]) => string;
  export type VariantProps<T> = any;
}
