/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import type { FunctionCall } from '@google/genai';
import { Session } from '@google/genai';
import { EventEmitter } from 'events';
import { config } from '../config/index.ts';
import MCPClient from './MCPClient.ts';
import { logger } from '../utils/logger.ts';

interface AudioChunk {
	data: string;
	mimeType: string;
};

interface TurnCompleteData {
	userText: string;
	userTranscript: string;
	modelTranscript: string;
	thoughtsText: string;
	modelAudio: AudioChunk[];
};

type ToolCall = FunctionCall & { id: string; name: string; args?: Record<string, unknown> };

export default class GeminiLiveClient extends EventEmitter {
	private client: GoogleGenAI;
	private session: Session | null = null;
	private model: string;
	private mcpClient: MCPClient;
	private currentUserTurnText: string = '';
	private currentUserTranscript: string = '';
	private currentModelTranscript: string = '';
	private currentThoughtsText: string = '';
	private currentModelAudioChunks: AudioChunk[] = [];

	// Type-safe overloads for emit
	emit(event: 'open'): boolean;
	emit(event: 'close', data: CloseEvent): boolean;
	emit(event: 'error', error: Error | unknown): boolean;
	emit(event: 'userText', text: string): boolean;
	emit(event: 'userTranscript', text: string): boolean;
	emit(event: 'modelTranscript', text: string): boolean;
	emit(event: 'interrupted'): boolean;
	emit(event: 'thoughts', text: string): boolean;
	emit(event: 'audio', data: string, mimeType: string): boolean;
	emit(event: 'turnComplete', data: TurnCompleteData): boolean;
	emit(event: 'toolCall', toolCall: ToolCall): boolean;
	emit(event: 'toolResult', data: any): boolean;
	emit(event: 'toolError', data: any): boolean;
	emit(event: string | symbol, ...args: any[]): boolean {
		return super.emit(event, ...args);
	};

	// Type-safe overloads for on
	on(event: 'open', listener: () => void): this;
	on(event: 'close', listener: (event: CloseEvent) => void): this;
	on(event: 'error', listener: (error: Error | unknown) => void): this;
	on(event: 'userText', listener: (text: string) => void): this;
	on(event: 'userTranscript', listener: (text: string) => void): this;
	on(event: 'modelTranscript', listener: (text: string) => void): this;
	on(event: 'interrupted', listener: () => void): this;
	on(event: 'thoughts', listener: (text: string) => void): this;
	on(event: 'audio', listener: (data: string, mimeType: string) => void): this;
	on(event: 'turnComplete', listener: (data: TurnCompleteData) => void): this;
	on(event: 'toolCall', listener: (toolCall: ToolCall) => void): this;
	on(event: 'toolResult', listener: (data: any) => void): this;
	on(event: 'toolError', listener: (data: any) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	};

	// Type-safe overloads for once
	once(event: 'open', listener: () => void): this;
	once(event: 'close', listener: (event: CloseEvent) => void): this;
	once(event: 'error', listener: (error: Error | unknown) => void): this;
	once(event: 'userText', listener: (text: string) => void): this;
	once(event: 'userTranscript', listener: (text: string) => void): this;
	once(event: 'modelTranscript', listener: (text: string) => void): this;
	once(event: 'interrupted', listener: () => void): this;
	once(event: 'thoughts', listener: (text: string) => void): this;
	once(event: 'audio', listener: (data: string, mimeType: string) => void): this;
	once(event: 'turnComplete', listener: (data: TurnCompleteData) => void): this;
	once(event: 'toolCall', listener: (toolCall: ToolCall) => void): this;
	once(event: 'toolResult', listener: (data: any) => void): this;
	once(event: 'toolError', listener: (data: any) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	};

	constructor(mcpClient: MCPClient) {
		super();
		this.client = new GoogleGenAI({ apiKey: config.google.apiKey });
		this.model = config.google.model;
		this.mcpClient = mcpClient;
	};

	public async connect(): Promise<void> {
		this.disconnect();

		try {
			// Get tool definitions from MCP servers
			const toolDefinitions = this.mcpClient.getToolDefinitionsForGemini();
			const toolsConfig = toolDefinitions.length > 0
				? [{ functionDeclarations: toolDefinitions }]
				: [];

			this.session = await this.client.live.connect({
				model: this.model,
				config: {
					responseModalities: [Modality.AUDIO],
					systemInstruction: 'You are a helpful audio assistant. Respond concisely.',
					inputAudioTranscription: {},
					outputAudioTranscription: {},
					...(toolsConfig.length > 0 && { tools: toolsConfig })
				},
				callbacks: {
					onopen: async () => {
						logger.success('Connected to Gemini Live API');
						this.emit('open');
						// Send initial message to establish the connection
						setTimeout(async () => {
							if (this.session)
								await this.session.sendRealtimeInput({
									text: 'Hello!'
								});
						}, 100);
					},
					onmessage: async (message: LiveServerMessage) => {
						await this.handleMessage(message);
					},
					onclose: (event) => {
						logger.log('Disconnected from Gemini Live API');
						this.emit('close', event);
					},
					onerror: (error) => {
						logger.error('Gemini Live API Error:', error);
						this.emit('error', error);
					}
				}
			});
		} catch (error) {
			logger.error('Error connecting to Gemini Live API:', error);
			this.emit('error', error);
			throw error;
		};
	};

	public disconnect(): void {
		if (this.session) {
			if (this.session.conn)
				try {
					this.session.conn.close();
				} catch (e) {
					logger.error('Error closing connection:', e);
				};
			this.session = null;
		};
	};

	public async sendAudioChunk(base64Audio: string, mimeType: string = 'audio/pcm;rate=16000'): Promise<void> {
		if (!this.session) {
			logger.warn('Session not open, cannot send audio');
			return;
		};

		try {
			await this.session.sendRealtimeInput({
				media: {
					mimeType: mimeType,
					data: base64Audio
				}
			});
		} catch (error) {
			logger.error('Error sending audio:', error);
			this.emit('error', error);
		};
	};

	public async sendText(text: string): Promise<void> {
		if (!this.session) return;
		this.currentUserTurnText = text;
		this.emit('userText', text);
		try {
			await this.session.sendRealtimeInput({ text });
		} catch (error) {
			logger.error('Error sending text:', error);
			this.emit('error', error);
		};
	};

	private async handleToolCall(toolCall: any): Promise<void> {
		const { name, id, args } = toolCall;

		if (!name) {
			logger.error('Tool call missing name');
			return;
		};

		logger.info(`Handling tool call: ${name} (ID: ${id}) with args:`, args);

		try {
			const result = await this.mcpClient.executeTool(name, args);
			logger.success(`Tool executed: ${name} (ID: ${id})`);
			logger.log('Result:', result);
			this.emit('toolResult', { id, name, result });

			// Send tool response back to Gemini
			if (this.session)
				await this.session.sendToolResponse({
					functionResponses: {
						id,
						name,
						response: { output: result }
					}
				});
		} catch (error) {
			const errorMessage = (error as Error).message || String(error);
			logger.error(`Error executing tool ${name} (ID: ${id}):`, error);
			this.emit('toolError', { id, name, error: errorMessage });

			// Send error response back to Gemini
			if (this.session)
				await this.session.sendToolResponse({
					functionResponses: {
						id,
						name,
						response: { error: errorMessage }
					}
				});
		};
	};

	private async handleMessage(message: LiveServerMessage): Promise<void> {
		const { serverContent } = message;

		if (serverContent) {
			// Capture input transcription (user)
			if (serverContent.inputTranscription?.text) {
				process.stdout.write(serverContent.inputTranscription.text);
				this.currentUserTranscript += serverContent.inputTranscription.text;
				this.emit('userTranscript', serverContent.inputTranscription.text);
			};

			// Capture output transcription (model)
			if (serverContent.outputTranscription?.text) {
				process.stdout.write(serverContent.outputTranscription.text);
				this.currentModelTranscript += serverContent.outputTranscription.text;
				this.emit('modelTranscript', serverContent.outputTranscription.text);
			};

			if (serverContent.interrupted) {
				this.currentThoughtsText = '';
				this.emit('interrupted');
			};

			if (serverContent.modelTurn) {
				const parts = serverContent.modelTurn.parts;
				if (parts) {
					for (const part of parts) {
						if (part.text) {
							this.currentThoughtsText += part.text;
							this.emit('thoughts', part.text);
						};
						if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
							this.currentModelAudioChunks.push({
								data: part.inlineData.data,
								mimeType: part.inlineData.mimeType
							});
							this.emit('audio', part.inlineData.data, part.inlineData.mimeType);
						};
					};
				};
			};

			if (serverContent.turnComplete) {
				process.stdout.write('\n\n');
				this.emit('turnComplete', {
					userText: this.currentUserTurnText,
					userTranscript: this.currentUserTranscript,
					modelTranscript: this.currentModelTranscript,
					thoughtsText: this.currentThoughtsText,
					modelAudio: this.currentModelAudioChunks
				});
				// Reset for next turn
				this.currentUserTurnText = '';
				this.currentUserTranscript = '';
				this.currentModelTranscript = '';
				this.currentThoughtsText = '';
				this.currentModelAudioChunks = [];
			};
		} else if (message.toolCall) {
			// Handle MCP tool calls
			if (message.toolCall.functionCalls)
				for (const call of message.toolCall.functionCalls)
					this.handleToolCall(call);

			this.emit('toolCall', message.toolCall as ToolCall);
		};
	};
};
