/* eslint-disable @typescript-eslint/no-explicit-any */
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config/index.ts';
import Gemini from './Gemini.ts';
import MCPClient from './MCPClient.ts';
import { initializeDatabase, SessionManager, MessageStore } from './Database.ts';
import { logger } from '../utils/logger.ts';

export class Server {
	private wss: WebSocketServer;
	private sessionManager: SessionManager;
	private messageStore: MessageStore;
	private mcpClient: MCPClient;

	constructor() {
		initializeDatabase();
		this.sessionManager = new SessionManager();
		this.messageStore = new MessageStore();
		this.mcpClient = new MCPClient(config.mcp);

		this.wss = new WebSocketServer({ port: config.system.port });
		logger.success(`WebSocket server started on port ${config.system.port}`);

		this.wss.on('connection', (ws: WebSocket, req) => {
			logger.log('New client connected');
			this.handleConnection(ws, req);
		});

		// Initialize MCP servers
		this.initializeMCP();
	};

	private async initializeMCP(): Promise<void> {
		try {
			await this.mcpClient.initialize();
		} catch (error) {
			logger.error('Failed to initialize MCP:', error);
		};
	};

	public close(): void {
		this.mcpClient.shutdown();
		this.wss.close();
	};

	private handleConnection(ws: WebSocket, req: any): void {
		const geminiClient = new Gemini(this.mcpClient);
		let isGeminiReady = false;
		const messageQueue: string[] = [];

		// Extract session ID from headers or create new session
		const requestedSessionId = req.headers['x-session-id'] as string;
		let session = requestedSessionId
			? this.sessionManager.getSession(requestedSessionId)
			: null;

		if (session)
			logger.log(`Resuming existing session: ${session.id}`);
		else {
			session = this.sessionManager.createSession();
			logger.log(`Session created: ${session.id}`);
		};

		let currentTurnNumber = session.turn_count;

		// Connect to Gemini
		geminiClient.connect().then(() => {
			isGeminiReady = true;
			console.log('Gemini connection established');

			// Send setup_complete to client with session info
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({
					type: 'setup_complete',
					sessionId: session!.id,
					isNewSession: !requestedSessionId,
					resumedTurn: currentTurnNumber
				}));

			// Process queued messages
			while (messageQueue.length > 0) {
				const msg = messageQueue.shift();
				if (msg) this.processClientMessage(msg, geminiClient);
			};
		}).catch((error: Error) => {
			logger.error('Failed to connect to Gemini:', error);
			ws.close(1011, 'Failed to connect to Gemini');
		});

		// Forward messages from Gemini to Client
		geminiClient.on('audio', (data: string, mimeType: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'audio', data, mimeType }));
		});

		geminiClient.on('userTranscript', (text: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'userTranscript', text }));
		});

		geminiClient.on('modelTranscript', (text: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'modelTranscript', text }));
		});

		geminiClient.on('thoughts', (text: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'thoughts', text }));
		});

		geminiClient.on('userText', (text: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'userText', text }));
		});

		geminiClient.on('toolCall', (toolCall: any) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'toolCall', toolCall }));
		});

		geminiClient.on('toolResult', (data: any) => {
			logger.success(`Tool executed: ${data.name}`);
			logger.log('Result:', data.result);
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'toolResult', name: data.name, result: data.result }));
		});

		geminiClient.on('toolError', (data: any) => {
			logger.error(`Tool error: ${data.name}`, data.error);
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'toolError', name: data.name, error: data.error }));
		});

		geminiClient.on('interrupted', () => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'interrupted' }));
		});

		geminiClient.on('turnComplete', (turnData: any) => {
			currentTurnNumber++;
			logger.success(`Turn ${currentTurnNumber} completed`);

			// Store messages in database
			if (turnData.userTranscript)
				this.messageStore.addMessage(session!.id, currentTurnNumber, 'user', turnData.userTranscript);
			if (turnData.modelTranscript)
				this.messageStore.addMessage(session!.id, currentTurnNumber, 'model', turnData.modelTranscript);
			this.messageStore.addMessage(session!.id, currentTurnNumber, 'thoughts', turnData.thoughtsText);

			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'turnComplete', turnNumber: currentTurnNumber }));
		});

		geminiClient.on('error', (error: any) => {
			logger.error('Gemini client error:', error);
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'error', message: 'Gemini API error' }));
		});

		geminiClient.on('close', () => {
			logger.log('Gemini connection closed');
			if (ws.readyState === WebSocket.OPEN)
				ws.close();
		});

		// Forward messages from Client to Gemini
		ws.on('message', (data) => {
			const message = data.toString();
			if (!isGeminiReady) {
				logger.warn('Buffering message until Gemini is ready');
				messageQueue.push(message);
			} else {
				this.processClientMessage(message, geminiClient);
			};
		});

		ws.on('close', () => {
			logger.log('Client disconnected');
			geminiClient.disconnect();
		});

		ws.on('error', (error) => {
			logger.error('WebSocket error:', error);
			geminiClient.disconnect();
		});
	};

	private processClientMessage(message: string, geminiClient: Gemini): void {
		try {
			const parsed = JSON.parse(message);

			if (parsed.type === 'audio' && parsed.data)
				geminiClient.sendAudioChunk(parsed.data);
			else if (parsed.type === 'text' && parsed.text)
				geminiClient.sendText(parsed.text);
		} catch (error) {
			logger.error('Error parsing message from client:', error);
		};
	};
};
