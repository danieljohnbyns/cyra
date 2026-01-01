/* eslint-disable @typescript-eslint/no-explicit-any */
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config/index.ts';
import Gemini from './Gemini.ts';
import MCPClient from './MCPClient.ts';
import { logger } from '../utils/logger.ts';

export class Server {
	private wss: WebSocketServer;
	private mcpClient: MCPClient;

	constructor() {
		this.mcpClient = new MCPClient(config.mcp);

		this.wss = new WebSocketServer({ port: config.system.port });
		logger.hierarchy.report('success', 'WebSocket server ready', [`Port: ${config.system.port}`]);

		this.wss.on('connection', (ws: WebSocket) => {
			logger.info('New client connected');
			this.handleConnection(ws);
		});

		// Initialize MCP servers
		this.initializeMCP();
	};

	private async initializeMCP(): Promise<void> {
		try {
			await this.mcpClient.initialize();
		} catch (error) {
			logger.hierarchy.report('error', 'Failed to initialize MCP', [String(error)]);
		};
	};

	public close(): void {
		this.mcpClient.shutdown();
		this.wss.close();
	};

	private handleConnection(ws: WebSocket): void {
		const geminiClient = new Gemini(this.mcpClient);
		let isGeminiReady = false;
		const messageQueue: string[] = [];

		// Connect to Gemini
		geminiClient.connect().then(() => {
			isGeminiReady = true;
			logger.hierarchy.report('success', 'Gemini connection established');

			// Send setup_complete to client
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({
					type: 'setup_complete'
				}));

			// Process queued messages
			while (messageQueue.length > 0) {
				const msg = messageQueue.shift();
				if (msg) this.processClientMessage(msg, geminiClient);
			};
		}).catch((error: Error) => {
			logger.hierarchy.report('error', 'Failed to connect to Gemini', [error.message]);
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
			logger.hierarchy.report('success', `Tool executed: ${data.name}`, [], JSON.stringify(data.result));
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'toolResult', name: data.name, result: data.result }));
		});

		geminiClient.on('toolError', (data: any) => {
			logger.hierarchy.report('error', `Tool error: ${data.name}`, [data.error]);
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'toolError', name: data.name, error: data.error }));
		});

		geminiClient.on('interrupted', () => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'interrupted' }));
		});

		geminiClient.on('turnComplete', () => {
			logger.hierarchy.report('success', 'Turn completed');

			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'turnComplete' }));
		});

		geminiClient.on('error', (error: any) => {
			logger.hierarchy.report('error', 'Gemini client error', [String(error)]);
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'error', message: 'Gemini API error' }));
		});

		geminiClient.on('close', () => {
			logger.info('Gemini connection closed');
			if (ws.readyState === WebSocket.OPEN)
				ws.close();
		});

		// Forward messages from Client to Gemini
		ws.on('message', (data) => {
			const message = data.toString();
			if (!isGeminiReady) {
				logger.debug('Buffering message until Gemini is ready');
				messageQueue.push(message);
			} else {
				this.processClientMessage(message, geminiClient);
			};
		});

		ws.on('close', () => {
			logger.info('Client disconnected');
			geminiClient.disconnect();
		});

		ws.on('error', (error) => {
			logger.hierarchy.report('error', 'WebSocket error', [error.message]);
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
			logger.hierarchy.report('error', 'Error parsing message from client', [String(error)]);
		};
	};
};
