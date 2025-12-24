import dotenv from 'dotenv';

dotenv.config();

/**
 * Configuration schema with validation
 */
interface GoogleConfig {
	apiKey: string;
	model: string;
}

interface AudioMicConfig {
	rate: string;
	bitwidth: string;
	channels: string;
	device: string;
}

interface AudioSpeakerConfig {
	channels: number;
	bitDepth: number;
	sampleRate: number;
}

interface AudioConfig {
	mic: AudioMicConfig;
	speaker: AudioSpeakerConfig;
}

interface SystemConfig {
	functionsPath: string;
	tmpDir: string;
}

export interface AppConfig {
	google: GoogleConfig;
	audio: AudioConfig;
	system: SystemConfig;
}

/**
 * Validates and returns application configuration
 * Throws error if required values are missing or invalid
 */
function validateConfig(): AppConfig {
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		throw new Error(
			'Missing required environment variable: GOOGLE_API_KEY. Please set it in .env file.'
		);
	}

	const model =
		process.env.GEMINI_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
	const micRate = process.env.MIC_RATE || '16000';
	const micBitwidth = process.env.MIC_BITWIDTH || '16';
	const micChannels = process.env.MIC_CHANNELS || '1';
	const micDevice = process.env.MIC_DEVICE || 'plughw:2,0';
	const speakerChannels = parseInt(process.env.SPEAKER_CHANNELS || '1', 10);
	const speakerBitDepth = parseInt(process.env.SPEAKER_BIT_DEPTH || '16', 10);
	const speakerSampleRate = parseInt(
		process.env.SPEAKER_SAMPLE_RATE || '24000',
		10
	);
	const functionsPath = process.env.FUNCTIONS_PATH || 'src/functions';
	const tmpDir = process.env.TMP_DIR || 'tmp';

	// Validate numeric values
	if (isNaN(speakerChannels) || speakerChannels < 1) {
		throw new Error('SPEAKER_CHANNELS must be a positive integer');
	}
	if (isNaN(speakerBitDepth) || ![8, 16, 24, 32].includes(speakerBitDepth)) {
		throw new Error('SPEAKER_BIT_DEPTH must be 8, 16, 24, or 32');
	}
	if (isNaN(speakerSampleRate) || speakerSampleRate < 8000) {
		throw new Error('SPEAKER_SAMPLE_RATE must be at least 8000');
	}

	return {
		google: {
			apiKey,
			model
		},
		audio: {
			mic: {
				rate: micRate,
				bitwidth: micBitwidth,
				channels: micChannels,
				device: micDevice
			},
			speaker: {
				channels: speakerChannels,
				bitDepth: speakerBitDepth,
				sampleRate: speakerSampleRate
			}
		},
		system: {
			functionsPath,
			tmpDir
		}
	};
}

export const config = validateConfig();
