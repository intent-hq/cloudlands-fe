/**
 * Result Type
 *
 * A discriminated union type for handling success and error cases
 */

/**
 * Success result
 */
export interface Ok<T> {
  ok: true;
  data: T;
}

/**
 * Error result
 */
export interface Err<E> {
  ok: false;
  error: E;
}

/**
 * Result type - either Ok or Err
 */
export type Result<T, E = string> = Ok<T> | Err<E>;

/**
 * Helper functions for creating and working with Result types.
 * Provides a functional approach to error handling without exceptions.
 *
 * @example
 * ```typescript
 * const result = await Result.fromPromise(fetchData());
 * if (Result.isOk(result)) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export const Result = {
  /**
   * Create a success result.
   *
   * @param data - The successful value to wrap
   * @returns An Ok result containing the data
   * @example
   * ```typescript
   * return Result.ok({ id: 123, name: 'Success' });
   * ```
   */
  ok<T>(data: T): Ok<T> {
    return { ok: true, data };
  },

  /**
   * Create an error result.
   *
   * @param error - The error value to wrap
   * @returns An Err result containing the error
   * @example
   * ```typescript
   * return Result.err('File not found');
   * ```
   */
  err<E = string>(error: E): Err<E> {
    return { ok: false, error };
  },

  /**
   * Type guard to check if a result is successful.
   *
   * @param result - The result to check
   * @returns True if the result is Ok, with type narrowing
   * @example
   * ```typescript
   * if (Result.isOk(result)) {
   *   // result.data is now accessible
   *   console.log(result.data);
   * }
   * ```
   */
  isOk<T, E>(result: Result<T, E>): result is Ok<T> {
    return result.ok === true;
  },

  /**
   * Type guard to check if a result is an error.
   *
   * @param result - The result to check
   * @returns True if the result is Err, with type narrowing
   * @example
   * ```typescript
   * if (Result.isErr(result)) {
   *   // result.error is now accessible
   *   console.error(result.error);
   * }
   * ```
   */
  isErr<T, E>(result: Result<T, E>): result is Err<E> {
    return result.ok === false;
  },

  /**
   * Transform the data in a successful result.
   * If the result is an error, it passes through unchanged.
   *
   * @param result - The result to map
   * @param fn - Function to transform the data
   * @returns A new result with transformed data or the original error
   * @example
   * ```typescript
   * const doubled = Result.map(Result.ok(5), x => x * 2);
   * // Returns: Result.ok(10)
   * ```
   */
  map<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
    if (result.ok) {
      return Result.ok(fn(result.data));
    }
    return result;
  },

  /**
   * Transform the error in a failed result.
   * If the result is successful, it passes through unchanged.
   *
   * @param result - The result to map
   * @param fn - Function to transform the error
   * @returns A new result with the original data or transformed error
   * @example
   * ```typescript
   * const detailed = Result.mapErr(
   *   Result.err('Failed'),
   *   err => `Operation failed: ${err}`
   * );
   * ```
   */
  mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    if (!result.ok) {
      return Result.err(fn(result.error));
    }
    return result;
  },

  /**
   * Extract the value from a successful result or throw an error.
   * Use with caution - prefer checking with isOk() first.
   *
   * @param result - The result to unwrap
   * @returns The data if successful
   * @throws Error if the result is an error
   * @example
   * ```typescript
   * try {
   *   const data = Result.unwrap(result);
   *   console.log(data);
   * } catch (e) {
   *   console.error('Failed to unwrap:', e);
   * }
   * ```
   */
  unwrap<T, E>(result: Result<T, E>): T {
    if (result.ok) {
      return result.data;
    }
    throw new Error(`Result error: ${result.error}`);
  },

  /**
   * Extract the value from a result or return a default value.
   * Safe alternative to unwrap() that never throws.
   *
   * @param result - The result to unwrap
   * @param defaultValue - Value to return if result is an error
   * @returns The data if successful, or the default value
   * @example
   * ```typescript
   * const value = Result.unwrapOr(result, 'default');
   * // Never throws, always returns a value
   * ```
   */
  unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    if (result.ok) {
      return result.data;
    }
    return defaultValue;
  },

  /**
   * Convert a Promise to a Result, catching any errors.
   * Useful for safely handling async operations without try/catch.
   *
   * @param promise - The promise to convert
   * @returns A Result containing either the resolved value or error message
   * @example
   * ```typescript
   * const result = await Result.fromPromise(fetchUser(id));
   * if (Result.isOk(result)) {
   *   console.log('User:', result.data);
   * } else {
   *   console.error('Failed:', result.error);
   * }
   * ```
   */
  async fromPromise<T>(promise: Promise<T>): Promise<Result<T, string>> {
    try {
      const data = await promise;
      return Result.ok(data);
    } catch (error) {
      return Result.err(error instanceof Error ? error.message : String(error));
    }
  },
};
