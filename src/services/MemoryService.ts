import {
	DatabaseService,
	type ConversationMessage
} from './DatabaseService.ts';

export class MemoryService {
	private db: DatabaseService;

	constructor() {
		this.db = new DatabaseService();
	};

	/**
	 * Add a user message to persistent storage
	 */
	public addUserMessage(content: string): ConversationMessage {
		return this.db.addMessage('user', content);
	};

	/**
	 * Add an assistant message to persistent storage
	 */
	public addAssistantMessage(content: string): ConversationMessage {
		return this.db.addMessage('assistant', content);
	};

	/**
	 * Add an AI thought/reasoning to persistent storage
	 */
	public addThought(content: string): ConversationMessage {
		return this.db.addMessage('thought', content);
	};

	/**
	 * Get the full conversation history for context injection
	 */
	public getConversationHistory(): ConversationMessage[] {
		return this.db.getAllMessages();
	};

	/**
	 * Get recent messages for context (limit to last N)
	 */
	public getRecentContext(limit: number = 20): ConversationMessage[] {
		return this.db.getRecentMessages(limit);
	};

	/**
	 * Format conversation history for Gemini context injection
	 */
	public formatHistoryForContext(): string {
		const messages = this.db.getAllMessages();
		if (messages.length === 0) return '';

		const formatted = messages
			.map((msg) => {
				const role = msg.role === 'thought' ? 'internal_thought' : msg.role;
				return `[${role.toUpperCase()}]\n${msg.content}`;
			})
			.join('\n\n');

		return `## Conversation History\n\n${formatted}`;
	};

	/**
	 * Get statistics about the conversation
	 */
	public getStats(): {
		totalMessages: number;
		userMessages: number;
		assistantMessages: number;
		thoughts: number;
		} {
		const messages = this.db.getAllMessages();
		return {
			totalMessages: messages.length,
			userMessages: messages.filter((m) => m.role === 'user').length,
			assistantMessages: messages.filter((m) => m.role === 'assistant').length,
			thoughts: messages.filter((m) => m.role === 'thought').length
		};
	};

	/**
	 * Close database connection
	 */
	public close(): void {
		this.db.close();
	};
};
