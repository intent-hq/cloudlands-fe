/**
 * Memory Management Module
 * Provides utilities and services for preventing memory leaks
 */

// Browser process services
export {
  DisposableStore,
  ComponentDisposalManager,
  componentDisposalManager,
  createDisposalHelper,
  type IDisposable,
} from './browser/disposal-manager.service';
export { globalCleanupService } from './browser/global-cleanup.service';

// Re-export commonly used functions for convenience
export { createDisposalHelper as useDisposable } from './browser/disposal-manager.service';
