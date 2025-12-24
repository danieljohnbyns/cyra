/**
 * Recorded thought/message in conversation log
 */
export interface ConversationEntry {
	role: 'user' | 'assistant' | 'system' | 'thought';
	content: string;
	timestamp: string;
}

/**
 * Audio callback handler
 */
export type AudioDataCallback = (data: Buffer) => void;
