import { notify } from '$lib/components/patterns/notify';
import { ErrorBoundaryService, type ErrorBoundaryOptions } from './error-boundary-core';
export type { ErrorBoundaryOptions } from './error-boundary-core';
// Source notification binding until renderer cutover; keeps the source convenience API.
export const errorBoundary = new ErrorBoundaryService(notify);
// Export convenience wrapper function
export async function withErrorBoundary<T>(
  operation: () => Promise<T>,
  operationName: string,
  options?: ErrorBoundaryOptions,
): Promise<T> {
  return errorBoundary.wrap(operation, operationName, options);
}
