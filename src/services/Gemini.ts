/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Session } from '@google/genai';
import { EventEmitter } from 'events';
import { config } from '../config/index.ts';

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

export default class GeminiLiveClient extends EventEmitter {
	private client: GoogleGenAI;
	private session: Session | null = null;
	private model: string;
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
	once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	};

	constructor() {
		super();
		this.client = new GoogleGenAI({ apiKey: config.google.apiKey });
		this.model = config.google.model;
	};

	public async connect(): Promise<void> {
		this.disconnect();

		try {
			this.session = await this.client.live.connect({
				model: this.model,
				config: {
					responseModalities: [Modality.AUDIO],
					systemInstruction: 'You are a helpful audio assistant. Respond concisely.',
					inputAudioTranscription: {},
					outputAudioTranscription: {}
				},
				callbacks: {
					onopen: async () => {
						console.log('Connected to Gemini Live API');
						this.emit('open');
						// Send initial message to establish the connection
						setTimeout(async () => {
							if (this.session)
								await this.session.sendRealtimeInput({
									text: 'Hello!'
								});
						}, 100);
					},
					onmessage: (message: LiveServerMessage) => {
						this.handleMessage(message);
					},
					onclose: (event) => {
						console.log('Disconnected from Gemini Live API');
						this.emit('close', event);
					},
					onerror: (error) => {
						console.error('Gemini Live API Error:', error);
						this.emit('error', error);
					}
				}
			});
		} catch (error) {
			console.error('Error connecting to Gemini Live API:', error);
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
					console.error('Error closing connection:', e);
				};
			this.session = null;
		};
	};

	public async sendAudioChunk(base64Audio: string, mimeType: string = 'audio/pcm;rate=16000'): Promise<void> {
		if (!this.session) {
			console.warn('Session not open, cannot send audio');
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
			console.error('Error sending audio:', error);
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
			console.error('Error sending text:', error);
			this.emit('error', error);
		};
	};

	private handleMessage(message: LiveServerMessage): void {
		const { serverContent } = message;

		if (serverContent) {
			// Capture input transcription (user)
			if (serverContent.inputTranscription?.text) {
				console.log(serverContent.inputTranscription.text);
				this.currentUserTranscript += serverContent.inputTranscription.text;
				this.emit('userTranscript', serverContent.inputTranscription.text);
			};

			// Capture output transcription (model)
			if (serverContent.outputTranscription?.text) {
				console.log(serverContent.outputTranscription.text);
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
		};
	};
};
