import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface ConversationMessage {
	id: number;
	role: 'user' | 'assistant' | 'system' | 'thought';
	content: string;
	timestamp: string;
	metadata?: Record<string, unknown>;
}

export class DatabaseService {
	private db: Database.Database;
	private dbPath: string;
	private schemaPath: string;

	constructor(dbDir: string = 'db', dbFileName: string = 'conversation.db') {
		this.dbPath = path.join(process.cwd(), dbDir, dbFileName);
		this.schemaPath = path.join(process.cwd(), dbDir, 'schema.sql');

		// Ensure db directory exists
		const dir = path.dirname(this.dbPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

		// Initialize database
		this.db = new Database(this.dbPath);
		this.db.pragma('journal_mode = WAL');
		this.initializeSchema();
	};

	private initializeSchema(): void {
		try {
			const schema = fs.readFileSync(this.schemaPath, 'utf-8');
			this.db.exec(schema);
		} catch (err) {
			console.error('Error initializing database schema:', err);
			throw err;
		};
	};

	/**
	 * Add a message to the persistent conversation
	 */
	public addMessage(
		role: 'user' | 'assistant' | 'system' | 'thought',
		content: string,
		metadata?: Record<string, unknown>
	): ConversationMessage {
		const timestamp = new Date().toISOString();
		const stmt = this.db.prepare(`
      INSERT INTO messages (role, content, timestamp, metadata)
      VALUES (?, ?, ?, ?)
    `);
		const info = stmt.run(
			role,
			content,
			timestamp,
			metadata ? JSON.stringify(metadata) : null
		);

		return {
			id: info.lastInsertRowid as number,
			role,
			content,
			timestamp,
			metadata
		};
	};

	/**
	 * Get all messages in the conversation
	 */
	public getAllMessages(): ConversationMessage[] {
		const stmt = this.db.prepare(`
      SELECT id, role, content, timestamp, metadata FROM messages
      ORDER BY timestamp ASC
    `);
		const messages = stmt.all().map(this.parseMessage);
		return this.mergeConsecutiveMessages(messages);
	};

	/**
	 * Get the last N messages (most recent first)
	 */
	public getRecentMessages(limit: number = 10): ConversationMessage[] {
		const stmt = this.db.prepare(`
      SELECT id, role, content, timestamp, metadata FROM messages
      ORDER BY timestamp DESC
      LIMIT ?
    `);
		const messages = stmt.all(limit).reverse().map(this.parseMessage);
		return this.mergeConsecutiveMessages(messages);
	};

	/**
	 * Get messages of a specific role
	 */
	public getMessagesByRole(
		role: 'user' | 'assistant' | 'system' | 'thought'
	): ConversationMessage[] {
		const stmt = this.db.prepare(`
      SELECT id, role, content, timestamp, metadata FROM messages
      WHERE role = ?
      ORDER BY timestamp ASC
    `);
		const messages = stmt.all(role).map(this.parseMessage);
		return this.mergeConsecutiveMessages(messages);
	};

	/**
	 * Clear all messages (start fresh)
	 */
	public clearMessages(): void {
		const stmt = this.db.prepare('DELETE FROM messages');
		stmt.run();
	};

	/**
	 * Get message count
	 */
	public getMessageCount(): number {
		const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
		const result = stmt.get() as { count: number };
		return result.count;
	};

	/**
	 * Close the database connection
	 */
	public close(): void {
		this.db.close();
	};

	/* eslint-disable @typescript-eslint/no-explicit-any */
	private parseMessage(msg: any): ConversationMessage {
		return {
			...msg,
			metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined
		};
	};

	/**
	 * Merge consecutive messages from the same role within a time threshold
	 * @param messages Array of messages to merge
	 * @param timeThresholdMs Merge messages within this many milliseconds (default: 30000 = 30 seconds)
	 */
	private mergeConsecutiveMessages(
		messages: ConversationMessage[],
		timeThresholdMs: number = 30000
	): ConversationMessage[] {
		if (messages.length === 0) return messages;

		const merged: ConversationMessage[] = [];
		let currentGroup = messages[0];

		for (let i = 1; i < messages.length; i++) {
			const current = messages[i];
			const timeDiff = new Date(current.timestamp).getTime() -
				new Date(currentGroup.timestamp).getTime();

			// If same role and within time threshold, merge
			if (current.role === currentGroup.role && timeDiff <= timeThresholdMs)
				currentGroup = {
					...currentGroup,
					content: `${currentGroup.content}\n\n${current.content}`
				};
			else {
				// Different role or time threshold exceeded, save and start new group
				merged.push(currentGroup);
				currentGroup = current;
			};
		};

		// Don't forget the last group
		merged.push(currentGroup);

		return merged;
	};
};
