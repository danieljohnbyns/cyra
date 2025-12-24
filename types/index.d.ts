import type { FunctionDeclaration } from '@google/genai';

/**
 * Extended tool interface combining Gemini's FunctionDeclaration with execute method
 * Using @google/genai's FunctionDeclaration type as the base
 */
export interface CyraTool extends FunctionDeclaration {
	/**
	 * Execute the tool with provided arguments
	 * Returns either output or error
	 */
	execute: (
		args?: Record<string, unknown>
	) => Promise<{ output: string } | { error: string }>;
}