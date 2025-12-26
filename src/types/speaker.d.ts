declare module 'speaker' {
	import { Writable } from 'stream';

	interface SpeakerOptions {
		channels?: number;
		bitDepth?: number;
		sampleRate?: number;
		signed?: boolean;
		float?: boolean;
		interleaved?: boolean;
		device?: string;
	};

	class Speaker extends Writable {
		constructor(options?: SpeakerOptions);
		end(): void;
	};

	export = Speaker;
}
