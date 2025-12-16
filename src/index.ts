import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI, Modality, Type } from '@google/genai';
// @ts-ignore
import mic from 'mic';
import * as readline from 'readline';
import Speaker from 'speaker';

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY)
	process.stdin.setRawMode(true);

const ai = new GoogleGenAI({
	apiKey: process.env.GOOGLE_API_KEY || ''
});

// -- Set up microphone input --
const micInstance = mic({
	rate: '16000',
	bitwidth: '16',
	channels: '1',
	device: 'plughw:2,0' // Use Plugged In USB Audio Device; change as needed
});
let listening = false;
const micInputStream = micInstance.getAudioStream();
console.log('Microphone initialized.');

// -- Set up speaker for audio output --
const speaker = new Speaker({
	channels: 1,
	bitDepth: 16,
	sampleRate: 24000
});
console.log('Speaker initialized.');

// -- Set up session with Gemini --
const session = await ai.live.connect({
	model: 'gemini-2.5-flash-native-audio-preview-12-2025',
	config: {
		responseModalities: [Modality.AUDIO],
		tools: [
			{
				functionDeclarations: [
					{
						name: 'set_alarm',
						description: 'Set an alarm for a specified time.',
						parameters: {
							type: Type.OBJECT,
							properties: {
								date: {
									type: Type.STRING,
									description: 'The date to set the alarm for, in YYYY-MM-DD format. If not specified, only assume today if the time has not yet passed today; otherwise, ask the user for clarification.'
								},
								time: {
									type: Type.STRING,
									description: 'The time to set the alarm for, in HH:MM format.'
								}
							},
							required: ['date', 'time']
						}
					}
				]
			}
		]
	},
	callbacks: {
		onopen: () => {
			listening = true;
			console.log('Listening... Press p to pause/play, q to quit, s to save recorded audio.');
		},
		onmessage: (message) => {
			// Check for tool calls at the top level
			if (message.toolCall)
				for (const functionCall of message.toolCall.functionCalls || []) {
					if (functionCall.name === 'set_alarm') {
						const args = functionCall.args || {};
						console.log(`\n[Tool Call] Setting alarm for ${args.date} at ${args.time}`);

						// Send the tool response back to the model
						session.sendToolResponse({
							functionResponses: [{
								id: functionCall.id,
								name: functionCall.name,
								response: { result: 'Alarm set successfully' }
							}]
						});
					};
				};

			if (message.serverContent?.modelTurn?.parts)
				for (const part of message.serverContent.modelTurn.parts) {
					if (part.inlineData?.mimeType === 'audio/pcm;rate=24000' && part.inlineData.data) {
						const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
						speaker.write(audioBuffer);
					};
				};
		},
		onerror: (err) => {
			console.error('Session error:', err);
		},
		onclose: (e) => {
			console.log('Session closed.', e);
			process.exit();
		}
	}
});

// -- Start sending microphone input to Gemini --
micInputStream.on('data', (data: Buffer) => {
	// Debug: Show volume level
	const volume = data.reduce((acc, val) => acc + Math.abs(val), 0) / data.length; // 0-255
	const volumeBar = '█'.repeat(Math.min(20, Math.floor(volume / 255)));
	process.stdout.write(`\rVolume: [${volumeBar.padEnd(20)}] ${Math.round(volume)}`);

	if (!listening) return;
	session.sendRealtimeInput({
		media: {
			data: data.toString('base64'),
			mimeType: 'audio/pcm;rate=16000'
		}
	});
});
micInstance.start();

// -- Handle keyboard input --
process.stdin.on('keypress', (str, key) => {
	if (key.name === 'p') {
		listening = !listening;
		console.log(listening ? '\nResumed listening.' : '\nPaused listening.');
	} else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
		console.log('\nExiting...');
		session.close();
		process.exit();
	};
});
process.on('exit', () => {
	micInstance.stop();
});
console.log('Setup complete.');