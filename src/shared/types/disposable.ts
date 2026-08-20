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
