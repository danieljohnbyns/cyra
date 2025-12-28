import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../../data/conversations.db');

let db: Database.Database | null = null;

export const initializeDatabase = (): Database.Database => {
	if (db) return db;

	db = new Database(dbPath);
	db.pragma('journal_mode = WAL');

	// Create tables if they don't exist
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			turn_count INTEGER DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			turn_number INTEGER NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
		CREATE INDEX IF NOT EXISTS idx_messages_turn ON messages(session_id, turn_number);
	`);

	logger.success('Database initialized:', dbPath);
	return db;
};

export const getDatabase = (): Database.Database => {
	if (!db)
		throw new Error('Database not initialized. Call initializeDatabase() first.');
	return db;
};

export interface Session {
	id: string;
	created_at: number;
	updated_at: number;
	turn_count: number;
};

export interface Message {
	id: string;
	session_id: string;
	turn_number: number;
	role: 'user' | 'model' | 'thoughts';
	content: string;
	created_at: number;
};

export class SessionManager {
	private db: Database.Database;

	constructor() {
		this.db = getDatabase();
	};

	createSession(): Session {
		const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = Date.now();

		const stmt = this.db.prepare(`
			INSERT INTO sessions (id, created_at, updated_at, turn_count)
			VALUES (?, ?, ?, 0)
		`);

		stmt.run(id, now, now);

		return {
			id,
			created_at: now,
			updated_at: now,
			turn_count: 0
		};
	};

	getSession(id: string): Session | null {
		const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
		return (stmt.get(id) as Session) || null;
	};

	updateSessionTimestamp(id: string): void {
		const stmt = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
		stmt.run(Date.now(), id);
	};

	incrementTurnCount(id: string): number {
		const stmt = this.db.prepare(`
			UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?
			RETURNING turn_count
		`);
		const result = stmt.get(Date.now(), id) as { turn_count: number };
		return result.turn_count;
	};

	getAllSessions(): Session[] {
		const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
		return (stmt.all() as Session[]) || [];
	};
};

export class MessageStore {
	private db: Database.Database;

	constructor() {
		this.db = getDatabase();
	};

	addMessage(sessionId: string, turnNumber: number, role: 'user' | 'model' | 'thoughts', content: string): Message {
		const id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = Date.now();

		const stmt = this.db.prepare(`
			INSERT INTO messages (id, session_id, turn_number, role, content, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		stmt.run(id, sessionId, turnNumber, role, content, now);

		// Update session timestamp
		const sessionStmt = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
		sessionStmt.run(now, sessionId);

		return {
			id,
			session_id: sessionId,
			turn_number: turnNumber,
			role,
			content,
			created_at: now
		};
	};

	getMessagesForTurn(sessionId: string, turnNumber: number): Message[] {
		const stmt = this.db.prepare(`
			SELECT * FROM messages 
			WHERE session_id = ? AND turn_number = ?
			ORDER BY created_at ASC
		`);
		return (stmt.all(sessionId, turnNumber) as Message[]) || [];
	};

	getSessionConversation(sessionId: string): Array<{ turnNumber: number; messages: Message[] }> {
		const stmt = this.db.prepare(`
			SELECT DISTINCT turn_number FROM messages
			WHERE session_id = ?
			ORDER BY turn_number ASC
		`);

		const turns = stmt.all(sessionId) as Array<{ turn_number: number }>;
		return turns.map(({ turn_number }) => ({
			turnNumber: turn_number,
			messages: this.getMessagesForTurn(sessionId, turn_number)
		}));
	};

	deleteSession(sessionId: string): void {
		const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
		stmt.run(sessionId);
	};

	clearAllData(): void {
		this.db.exec('DELETE FROM messages; DELETE FROM sessions;');
	};
};
