import dotenv from 'dotenv';

dotenv.config();

/**
 * Configuration schema with validation
 */
interface GoogleConfig {
	apiKey: string;
	model: string;
};

interface SystemConfig {
	port: number;
};

export interface AppConfig {
	google: GoogleConfig;
	system: SystemConfig;
};

/**
 * Validates and returns application configuration
 * Throws error if required values are missing or invalid
 */
const validateConfig = (): AppConfig => {
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey)
		throw new Error(
			'Missing required environment variable: GOOGLE_API_KEY. Please set it in .env file.'
		);

	const model =
		process.env.GEMINI_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';
	const port = parseInt(process.env.PORT || '3000', 10);

	// Validate numeric values
	if (isNaN(port) || port < 1000)
		throw new Error('PORT must be a positive integer >= 1000');

	return {
		google: {
			apiKey,
			model
		},
		system: {
			port
		}
	};
};

export const config = validateConfig();
