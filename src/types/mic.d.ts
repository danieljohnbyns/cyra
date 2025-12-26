declare module 'mic' {
	import { EventEmitter } from 'events';
	import { Readable } from 'stream';

	interface MicOptions {
		rate?: string | number;
		channels?: string | number;
		debug?: boolean;
		exitOnSilence?: number;
		device?: string;
		encoding?: string;
	};

	interface MicInstance extends EventEmitter {
		start(): void;
		stop(): void;
		pause(): void;
		resume(): void;
		getAudioStream(): Readable;
	};

	function mic(options?: MicOptions): MicInstance;

	export = mic;
}
