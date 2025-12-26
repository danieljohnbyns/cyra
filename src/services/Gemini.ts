import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Session } from '@google/genai';
import { EventEmitter } from 'events';
import { config } from '../config.ts';

export default class GeminiLiveClient extends EventEmitter {
	private client: GoogleGenAI;
	private session: Session | null = null;
	private model: string;

	constructor() {
		super();
		this.client = new GoogleGenAI({ apiKey: config.google.apiKey });
		this.model = config.google.model;
	};

	public async connect(): Promise<void> {
		this.disconnect();

		this.session = await this.client.live.connect({
			model: this.model,
			config: {
				responseModalities: [Modality.AUDIO]
			},
			callbacks: {
				onopen: () => {
					console.log('Connected to Gemini Live API');
					this.emit('open');
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
	};

	public disconnect(): void {
		if (this.session) {
			if (this.session.conn) {
				try {
					this.session.conn.close();
				} catch (e) {
					console.error('Error closing connection:', e);
				};
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
		try {
			await this.session.sendRealtimeInput({ text });
		} catch (error) {
			console.error('Error sending text:', error);
			this.emit('error', error);
		};
	};

	private handleMessage(message: LiveServerMessage): void {
		const { serverContent, toolCall } = message;

		if (serverContent) {
			if (serverContent.interrupted)
				this.emit('interrupted');

			if (serverContent.turnComplete)
				this.emit('turnComplete');

			if (serverContent.modelTurn) {
				const parts = serverContent.modelTurn.parts;
				if (parts)
					for (const part of parts) {
						if (part.text)
							this.emit('text', part.text);
						if (part.inlineData)
							this.emit('audio', part.inlineData.data, part.inlineData.mimeType);
					};
			};
		} else if (toolCall)
			this.emit('toolCall', toolCall);
	};
};
