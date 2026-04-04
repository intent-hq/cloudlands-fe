/**
 * Disposable interface for resource cleanup
 *
 * Implements the Disposable pattern for proper resource management
 * and memory leak prevention.
 */

/**
 * Interface for objects that need cleanup
 */
export interface IDisposable {
  /**
   * Dispose of all resources and cleanup
   */
  dispose(): void;
}

/**
 * Check if an object is disposable
 */
export function isDisposable(obj: any): obj is IDisposable {
  return obj && typeof obj.dispose === 'function';
}

/**
 * Safely dispose of an object
 */
export function safeDispose(obj: any): void {
  if (isDisposable(obj)) {
    try {
      obj.dispose();
    } catch {
      // Silently catch disposal errors to prevent cascading failures
    }
  }
}

/**
 * Dispose of multiple objects
 */
export function disposeAll(...objects: any[]): void {
  objects.forEach(safeDispose);
}
