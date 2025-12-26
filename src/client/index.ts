import WebSocket from 'ws';
import mic from 'mic';
import Speaker from 'speaker';
import { config } from '../config.ts';

const port = config.system.port || 3000;
const ws = new WebSocket(`ws://localhost:${port}`);

console.log(`Connecting to ws://localhost:${port}...`);

let micInstance: ReturnType<typeof mic> | null = null;
let speakerInstance: Speaker | null = null;

ws.on('open', () => {
	console.log('Connected to server');
});

ws.on('message', (data: WebSocket.Data) => {
	try {
		const message = JSON.parse(data.toString());
		if (message.type === 'setup_complete') {
			console.log('Server is ready (Gemini connected)');
			startAudio();
		} else if (message.type === 'audio')
			playAudio(message.data);
		else if (message.type === 'text')
			console.log('Gemini:', message.text);
		else if (message.type === 'interrupted')
			console.log('Interrupted');
		else if (message.type === 'turnComplete')
			console.log('Turn complete');
	} catch (error) {
		console.error('Error processing message:', error);
	};
});

ws.on('close', () => {
	console.log('Disconnected from server');
	stopAudio();
});

ws.on('error', (error) => {
	console.error('WebSocket error:', error);
});

const startAudio = () => {
	// Setup Microphone
	micInstance = mic({
		rate: '16000',
		channels: '1',
		debug: false,
		exitOnSilence: 6,
		device: 'plughw:2,0' // Adjust based on your system
	});

	const micInputStream = micInstance.getAudioStream();

	micInputStream.on('data', (data: Buffer) => {
		if (ws.readyState === WebSocket.OPEN)
			ws.send(JSON.stringify({
				type: 'audio',
				data: data.toString('base64')
			}));
	});

	micInputStream.on('error', (err: Error) => {
		console.error('Error in Input Stream: ' + err);
	});

	micInstance.start();
	console.log('Microphone started');

	// Setup Speaker
	speakerInstance = new Speaker({
		channels: 1,
		bitDepth: 16,
		sampleRate: 24000
	});

	speakerInstance.on('close', () => {
		console.log('Speaker closed');
	});
};

const stopAudio = () => {
	if (micInstance)
		micInstance.stop();
	if (speakerInstance)
		speakerInstance.end();
};

const playAudio = (base64Data: string) => {
	const buffer = Buffer.from(base64Data, 'base64');
	if (speakerInstance)
		speakerInstance.write(buffer);
};

// Handle process exit
process.on('SIGINT', () => {
	console.log('Stopping client...');
	stopAudio();
	ws.close();
	process.exit(0);
});