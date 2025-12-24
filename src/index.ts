/* eslint-disable no-undef */
import * as readline from 'readline';
import { AudioService } from './services/AudioService.ts';
import { ToolManager } from './services/ToolManager.ts';
import { GeminiService } from './services/GeminiService.ts';
import type { AudioDataCallback } from '../types/gemini.d.ts';

// Initialize services
const audioService = new AudioService();
const toolManager = new ToolManager();
const geminiService = new GeminiService(toolManager);

// Load tools
await toolManager.loadTools();

// Setup hot reload
toolManager.watch(async () => {
	console.log('Tools reloaded, reconnecting session...');
	// Reconnect session to update tools
	const callback: AudioDataCallback = (data: Buffer) => audioService.play(data);
	await geminiService.connect(callback);
});

// Connect session
let listening = false;

const startSession = async () => {
	const callback: AudioDataCallback = (data: Buffer) => audioService.play(data);
	await geminiService.connect(callback);
	listening = true;
	audioService.start();
	console.log(
		'Listening... Press p to pause/play, h for history, s for stats, q to quit.'
	);
};

await startSession();

// Handle Audio Input
audioService.on('input', (data: Buffer) => {
	// Debug: Volume level
	const volume = data.reduce((acc, val) => acc + Math.abs(val), 0) / data.length;
	process.stdout.write(`\rMic volume: ${volume.toFixed(2)}   `);

	if (listening) geminiService.sendAudio(data);
});

// Handle Keyboard Input
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
	if (key.name === 'p') {
		listening = !listening;
		console.log(listening ? '\nResumed listening.' : '\nPaused listening.');
	} else if (key.name === 'h') {
		// Show conversation history
		const history = geminiService.getMemoryService().getConversationHistory();
		console.log('\n=== Conversation History ===');
		if (history.length === 0) {
			console.log('No messages yet.');
		} else {
			history.forEach((msg) => {
				const role = msg.role.toUpperCase();
				console.log(`[${role}] ${msg.timestamp}`);
				console.log(
					`  ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n`
				);
			});
		}
		console.log('=============================\n');
	} else if (key.name === 's') {
		// Show statistics
		const stats = geminiService.getMemoryService().getStats();
		console.log('\n=== Conversation Statistics ===');
		console.log(`Total messages: ${stats.totalMessages}`);
		console.log(`User messages: ${stats.userMessages}`);
		console.log(`Assistant messages: ${stats.assistantMessages}`);
		console.log(`Thoughts: ${stats.thoughts}`);
		console.log('================================\n');
	} else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
		console.log('\nExiting...');
		geminiService.disconnect();
		audioService.stop();
		toolManager.stopWatching();
		process.exit();
	}
});
