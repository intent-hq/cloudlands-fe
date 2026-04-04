/**
 * Development Tools for Type System
 *
 * Provides development-time tools for validating types, checking handler
 * registration, and debugging type issues. Only active in development mode.
 */

import { handlerRegistry, type ValidationReport } from './registry';
import { IpcContracts, type IpcContractKey } from './contracts';
import { validateIpcRequest, validateIpcResponse } from './validation';
import { Logger } from '../logger';
import { TypeValidationError } from './errors';

const logger = new Logger('TypeDevTools');

// ============================================================================
// Development Mode Check
// ============================================================================

const isDevelopment = process.env.NODE_ENV === 'development';

// ============================================================================
// Type System Inspector
// ============================================================================

export class TypeSystemInspector {
  private static instance: TypeSystemInspector;

  static getInstance(): TypeSystemInspector {
    if (!this.instance) {
      this.instance = new TypeSystemInspector();
    }
    return this.instance;
  }

  /**
   * Validate all registered handlers
   */
  validateHandlers(): ValidationReport {
    if (!isDevelopment) {
      logger.warn('Handler validation is only available in development mode');
      return { valid: true, totalRequired: 0, totalRegistered: 0, unregistered: [], metadata: {} };
    }

    const report = handlerRegistry.validate();

    if (!report.valid) {
      logger.error('Handler validation failed', {
        unregistered: report.unregistered,
      });

      // Log detailed information for each unregistered handler
      for (const channel of report.unregistered) {
        const metadata = report.metadata[channel];
        logger.error(`Missing handler: ${channel}`, metadata);
      }
    }

    return report;
  }

  /**
   * Check type compatibility between request and response
   */
  checkTypeCompatibility<K extends IpcContractKey>(
    channel: K,
    request: unknown,
    response: unknown,
  ): { valid: boolean; errors: string[] } {
    if (!isDevelopment) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    // Validate request
    const requestValidation = validateIpcRequest(channel, request);
    if (!requestValidation.success) {
      errors.push(`Request validation failed: ${JSON.stringify(requestValidation.errors)}`);
    }

    // Validate response
    const responseValidation = validateIpcResponse(channel, response);
    if (!responseValidation.success) {
      errors.push(`Response validation failed: ${JSON.stringify(responseValidation.errors)}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate type report for all contracts
   */
  generateTypeReport(): TypeReport {
    const report: TypeReport = {
      timestamp: new Date().toISOString(),
      contracts: {},
      handlers: handlerRegistry.getStats(),
    };

    for (const [channel, contract] of Object.entries(IpcContracts)) {
      report.contracts[channel] = {
        hasRequest: !!contract.request,
        hasResponse: !!contract.response,
        isRegistered: handlerRegistry.isRegistered(channel),
      };
    }

    return report;
  }

  /**
   * Validate data against a specific contract
   */
  validateData<K extends IpcContractKey>(
    channel: K,
    direction: 'request' | 'response',
    data: unknown,
  ): void {
    if (!isDevelopment) return;

    const validation =
      direction === 'request'
        ? validateIpcRequest(channel, data)
        : validateIpcResponse(channel, data);

    if (!validation.success) {
      throw new TypeValidationError(channel, validation.errors || [], data);
    }
  }
}

// ============================================================================
// Types
// ============================================================================

export interface TypeReport {
  timestamp: string;
  contracts: Record<
    string,
    {
      hasRequest: boolean;
      hasResponse: boolean;
      isRegistered: boolean;
    }
  >;
  handlers: {
    required: number;
    registered: number;
    unregistered: number;
    handlers: string[];
  };
}

// ============================================================================
// Global Instance
// ============================================================================

export const typeInspector = TypeSystemInspector.getInstance();

// ============================================================================
// Console API (Development Only)
// ============================================================================

if (isDevelopment && typeof window !== 'undefined') {
  (window as any).TypeSystem = {
    inspect: () => typeInspector.generateTypeReport(),
    validateHandlers: () => typeInspector.validateHandlers(),
    checkType: (channel: string, direction: 'request' | 'response', data: any) =>
      typeInspector.validateData(channel as IpcContractKey, direction, data),
  };
}
