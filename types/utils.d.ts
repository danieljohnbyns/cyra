/**
 * Utility types for error handling and results
 */

/**
 * Represents a successful result
 */
export interface Success<T> {
	type: 'success';
	output: T;
}

/**
 * Represents an error result
 */
export interface ErrorResult {
	type: 'error';
	error: string;
	details?: Record<string, unknown>;
}

/**
 * Union type for success or error
 */
export type Result<T> = Success<T> | ErrorResult;

/**
 * Represents retry configuration
 */
export interface RetryPolicy {
	maxAttempts: number;
	initialDelayMs: number;
	backoffMultiplier: number;
}

/**
 * Represents timeout configuration
 */
export interface TimeoutConfig {
	defaultTimeoutMs: number;
	toolSpecificTimeouts?: Record<string, number>;
}

/**
 * Service configuration for error handling
 */
export interface ErrorHandlingConfig {
	retry: RetryPolicy;
	timeout: TimeoutConfig;
}
