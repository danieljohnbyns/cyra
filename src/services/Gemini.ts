/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import type { FunctionCall } from '@google/genai';
import { Session } from '@google/genai';
import { EventEmitter } from 'events';
import { config } from '../config/index.ts';
import MCPClient from './MCPClient.ts';
import { logger } from '../utils/logger.ts';

import fs from 'fs';
import path from 'path';

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

		const systemPrompt = fs.readFileSync(path.join(process.cwd(), 'SystemPrompt.md'), 'utf-8');

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
					systemInstruction: systemPrompt,
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
						try {
							await this.handleMessage(message);
						} catch (error) {
							logger.hierarchy.report('error', 'CRITICAL: Error handling message', [
								error instanceof Error ? error.message : String(error)
							]);
							console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack');
						};
					},
					onclose: (event) => {
						logger.hierarchy.report('success', 'Disconnected from Gemini Live API', ['Event code: ' + event.code, 'Reason: ' + event.reason]);
						this.emit('close', event);
					},
					onerror: (error) => {
						logger.hierarchy.report('error', 'Gemini Live API Error', [String(error)]);
						if (error instanceof Error)
							console.error('Error stack:', error.stack);

						this.emit('error', error);
					}
				}
			});
		} catch (error) {
			logger.hierarchy.report('error', 'Error connecting to Gemini Live API', [String(error)]);
			this.emit('error', error);
			throw error;
		};
	};

	public disconnect(): void {
		logger.info('Calling disconnect on Gemini client');
		if (this.session) {
			logger.info('Session exists, attempting to close connection');
			if (this.session.conn) {
				try {
					this.session.conn.close();
					logger.info('Connection closed successfully');
				} catch (error) {
					logger.warn('Error closing connection:', error instanceof Error ? error.message : String(error));
				};
			};
			this.session = null;
		} else {
			logger.info('No session to disconnect');
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
			logger.hierarchy.report('error', 'Error sending audio', [String(error)]);
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
			logger.hierarchy.report('error', 'Error sending text', [String(error)]);
			this.emit('error', error);
		};
	};

	private async handleToolCall(toolCall: any): Promise<void> {
		const { name, id, args } = toolCall;

		if (!name) {
			logger.error('Tool call missing name');
			return;
		};

		logger.hierarchy.section('Handling tool call', [`Name: ${name}`, `ID: ${id}`], `Args: ${JSON.stringify(args)}`);

		try {
			logger.info(`Executing tool: ${name}`);
			const result = await this.mcpClient.executeTool(name, args);
			logger.hierarchy.report('success', `Tool executed: ${name} (ID: ${id})`, [], JSON.stringify(result));
			this.emit('toolResult', { id, name, result });

			// Send tool response back to Gemini
			logger.info(`Sending tool response for ${name} (ID: ${id})`);
			try {
				if (!this.session) {
					logger.error(`Session not available when sending tool response for ${name}`);
					return;
				};
				await this.session.sendToolResponse({
					functionResponses: {
						id,
						name,
						response: { output: result }
					}
				});
				logger.info(`Tool response sent successfully for ${name} (ID: ${id})`);
				// Give Gemini a moment to process the response
				await new Promise(resolve => setTimeout(resolve, 100));
			} catch (sendError) {
				logger.hierarchy.report('error', `Failed to send tool response for ${name}`, [
					sendError instanceof Error ? sendError.message : String(sendError)
				]);
				console.error('Send error details:', sendError);
			};
		} catch (error) {
			const errorMessage = (error as Error).message || String(error);
			logger.hierarchy.report('error', `Error executing tool ${name} (ID: ${id})`, [errorMessage]);
			console.error('Tool execution error:', error);
			this.emit('toolError', { id, name, error: errorMessage });

			// Send error response back to Gemini
			logger.info(`Sending error response for tool ${name} (ID: ${id})`);
			try {
				if (!this.session) {
					logger.error(`Session not available when sending error response for ${name}`);
					return;
				};
				await this.session.sendToolResponse({
					functionResponses: {
						id,
						name,
						response: { error: errorMessage }
					}
				});
				logger.info(`Error response sent successfully for ${name} (ID: ${id})`);
				// Give Gemini a moment to process the error response
				await new Promise(resolve => setTimeout(resolve, 100));
			} catch (sendError) {
				logger.hierarchy.report('error', `Failed to send error response for ${name}`, [
					sendError instanceof Error ? sendError.message : String(sendError)
				]);
				console.error('Send error details:', sendError);
			};
		};
	};

	private async handleMessage(message: LiveServerMessage): Promise<void> {
		try {
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
				if (message.toolCall.functionCalls) {
					for (const call of message.toolCall.functionCalls) {
						try {
							await this.handleToolCall(call);
						} catch (toolError) {
							logger.hierarchy.report('error', 'Unhandled error in tool call handler', [
								toolError instanceof Error ? toolError.message : String(toolError)
							]);
						};
					};
				};

				this.emit('toolCall', message.toolCall as ToolCall);
			};
		} catch (error) {
			logger.hierarchy.report('error', 'Unhandled error in handleMessage', [
				error instanceof Error ? error.message : String(error)
			]);
		};
	};
};
