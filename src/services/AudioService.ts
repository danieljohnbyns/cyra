/* eslint-disable no-undef */
import mic from 'mic';
import type { MicInstance } from 'mic';
import Speaker from 'speaker';
import { config } from '../config.ts';
import { EventEmitter } from 'events';

export class AudioService extends EventEmitter {
	private micInstance: MicInstance;
	private micInputStream: NodeJS.ReadableStream;
	private speaker: Speaker;

	constructor() {
		super();
		console.log(
			`Initializing AudioService with device: ${config.audio.mic.device}`
		);

		this.micInstance = mic({
			rate: config.audio.mic.rate,
			bitwidth: config.audio.mic.bitwidth,
			channels: config.audio.mic.channels,
			device: config.audio.mic.device,
			debug: false,
			exitOnSilence: 0
		});
		this.micInputStream = this.micInstance.getAudioStream();

		this.speaker = new Speaker({
			channels: config.audio.speaker.channels,
			bitDepth: config.audio.speaker.bitDepth,
			sampleRate: config.audio.speaker.sampleRate
		});

		this.setupMicListeners();
	};

	private setupMicListeners() {
		this.micInputStream.on('data', (data: Buffer) => {
			this.emit('input', data);
		});

		this.micInputStream.on('error', (err: Error) => {
			console.error('Microphone error:', err);
		});
	};

	public start(): void {
		this.micInstance.start();
	};

	public stop(): void {
		this.micInstance.stop();
	};

	public play(data: Buffer): void {
		this.speaker.write(data);
	};
};
