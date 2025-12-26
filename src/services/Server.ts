import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.ts';
import Gemini from './Gemini.ts';

export class Server {
	private wss: WebSocketServer;

	constructor() {
		this.wss = new WebSocketServer({ port: config.system.port });
		console.log(`WebSocket server started on port ${config.system.port}`);

		this.wss.on('connection', (ws: WebSocket) => {
			console.log('New client connected');
			this.handleConnection(ws);
		});
	};

	public close(): void {
		this.wss.close();
	};

	private handleConnection(ws: WebSocket): void {
		const geminiClient = new Gemini();
		let isGeminiReady = false;
		const messageQueue: string[] = [];

		// Connect to Gemini
		geminiClient.connect().then(() => {
			isGeminiReady = true;
			console.log('Gemini connection established');

			// Send setup_complete to client
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'setup_complete' }));

			// Process queued messages
			while (messageQueue.length > 0) {
				const msg = messageQueue.shift();
				if (msg) this.processClientMessage(msg, geminiClient);
			};
		}).catch((error: Error) => {
			console.error('Failed to connect to Gemini:', error);
			ws.close(1011, 'Failed to connect to Gemini');
		});

		// Forward messages from Gemini to Client
		geminiClient.on('audio', (data: string, mimeType: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'audio', data, mimeType }));
		});

		geminiClient.on('text', (text: string) => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'text', text }));
		});

		geminiClient.on('interrupted', () => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'interrupted' }));
		});

		geminiClient.on('turnComplete', () => {
			if (ws.readyState === WebSocket.OPEN)
				ws.send(JSON.stringify({ type: 'turnComplete' }));
		});

		geminiClient.on('close', () => {
			console.log('Gemini connection closed');
			if (ws.readyState === WebSocket.OPEN)
				ws.close();
		});

		// Forward messages from Client to Gemini
		ws.on('message', (data) => {
			const message = data.toString();
			if (!isGeminiReady) {
				console.log('Buffering message until Gemini is ready');
				messageQueue.push(message);
			} else {
				this.processClientMessage(message, geminiClient);
			};
		});

		ws.on('close', () => {
			console.log('Client disconnected');
			geminiClient.disconnect();
		});

		ws.on('error', (error) => {
			console.error('WebSocket error:', error);
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
			console.error('Error parsing message from client:', error);
		};
	};
};
