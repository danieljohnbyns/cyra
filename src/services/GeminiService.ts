/* eslint-disable no-undef */
import { GoogleGenAI, Modality } from '@google/genai';
import type {
	Session,
	LiveServerMessage,
	LiveServerToolCall
} from '@google/genai';
import { config } from '../config.ts';
import { ToolManager } from './ToolManager.ts';
import { MemoryService } from './MemoryService.ts';
import type {
	ConversationEntry,
	AudioDataCallback
} from '../../types/gemini.d.ts';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';

export class GeminiService {
	private client: GoogleGenAI;
	private session: Session | null = null;
	private toolManager: ToolManager;
	private memoryService: MemoryService;
	private thoughtLog: ConversationEntry[] = [];
	private logFile: string;

	constructor(toolManager: ToolManager) {
		this.client = new GoogleGenAI({ apiKey: config.google.apiKey });
		this.toolManager = toolManager;
		this.memoryService = new MemoryService();

		if (!fs.existsSync(path.resolve(process.cwd(), config.system.tmpDir)))
			fs.mkdirSync(path.resolve(process.cwd(), config.system.tmpDir), {
				recursive: true
			});

		this.logFile = path.join(
			process.cwd(),
			config.system.tmpDir,
			`cyra_thought_${Date.now()}.json`
		);
	};

	public getMemoryService(): MemoryService {
		return this.memoryService;
	};

	public async connect(onAudioData: AudioDataCallback): Promise<void> {
		if (this.session) await this.disconnect();

		this.session = await this.client.live.connect({
			model: config.google.model,
			config: {
				responseModalities: [Modality.AUDIO],
				inputAudioTranscription: {},
				outputAudioTranscription: {},
				tools: [{ functionDeclarations: this.toolManager.getTools() }]
			},
			callbacks: {
				onopen: () => {
					console.log('Gemini session connected.');
				},
				onmessage: (message: LiveServerMessage) => {
					this.handleMessage(message, onAudioData).catch((err) =>
						console.error('Error handling message:', err)
					);
				},
				onerror: (err: ErrorEvent | Error) => {
					if (err instanceof Error)
						console.error('Gemini session error:', err.message);
					else console.error('Gemini session error:', err);
				},
				onclose: (e: CloseEvent) => console.log('Gemini session closed.', e)
			}
		});

		await this.sendSystemPrompt();
	};

	public async disconnect(): Promise<void> {
		if (this.session) {
			this.session.close();
			this.session = null;
		};
		this.memoryService.close();
	};

	public sendAudio(data: Buffer): void {
		if (!this.session) return;
		this.session.sendRealtimeInput({
			media: {
				data: data.toString('base64'),
				mimeType: 'audio/pcm;rate=16000'
			}
		});
	};

	private async handleMessage(
		message: LiveServerMessage,
		onAudioData: AudioDataCallback
	): Promise<void> {
		// Handle input transcription (user audio)
		if (
			message.serverContent &&
			'inputTranscription' in message.serverContent &&
			message.serverContent.inputTranscription
		) {
			const transcript = message.serverContent.inputTranscription.text;
			if (transcript) {
				this.memoryService.addUserMessage(transcript);
				console.log(`User: ${transcript}`);
			};
		};

		// Handle output transcription (assistant audio)
		if (
			message.serverContent &&
			'outputTranscription' in message.serverContent &&
			message.serverContent.outputTranscription
		) {
			const transcript = message.serverContent.outputTranscription.text;
			if (transcript) {
				this.memoryService.addAssistantMessage(transcript);
				console.log(`Assistant: ${transcript}`);
			};
		};

		// Log thoughts and store them in memory
		if (message.serverContent?.modelTurn?.parts)
			for (const part of message.serverContent.modelTurn.parts)
				if (part.text) {
					this.logThought('assistant', part.text);
					this.memoryService.addThought(part.text);
				};

		// Handle Tool Calls
		if (message.toolCall) await this.handleToolCalls(message.toolCall);

		// Handle Audio Output (play audio)
		if (message.serverContent?.modelTurn?.parts)
			for (const part of message.serverContent.modelTurn.parts)
				if (
					part.inlineData?.mimeType &&
					part.inlineData.mimeType.startsWith('audio/pcm') &&
					part.inlineData.data
				) {
					const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
					onAudioData(audioBuffer);
				};
	};

	private async handleToolCalls(toolCall: LiveServerToolCall): Promise<void> {
		for (const functionCall of toolCall.functionCalls || []) {
			const toolName = functionCall.name;
			if (!toolName) {
				console.error('Tool call without a name received.');
				continue;
			};

			const tool = this.toolManager.getTool(toolName);
			console.log(`Tool \`${toolName}\` executed.`);

			if (!tool) {
				console.error(`Tool ${toolName} not found.`);
				continue;
			};
			try {
				const result = await tool.execute(functionCall.args || {});
				if ('error' in result) console.error(result.error);
				else console.log(result.output);

				this.session?.sendToolResponse({
					functionResponses: {
						id: functionCall.id || '',
						name: tool.name,
						response: result
					}
				});
			} catch (err) {
				console.error(`Error executing tool ${tool.name}:`, err);
			};
		};
	};

	private async sendSystemPrompt(): Promise<void> {
		if (!this.session) return;
		const systemPromptPath = path.resolve(process.cwd(), 'SystemPrompt.md');
		try {
			const systemPrompt = await fsp.readFile(systemPromptPath, 'utf-8');

			// Dynamic context injection
			const readRepo = this.toolManager.getTool('read_repository');
			const inspectEnv = this.toolManager.getTool('inspect_environment');

			let repoStructure = 'Not available';
			let cliTools = 'Not available';

			if (readRepo) {
				const res = await readRepo.execute({});
				if ('output' in res) repoStructure = res.output;
			};
			if (inspectEnv) {
				const res = await inspectEnv.execute({});
				if ('output' in res) cliTools = res.output;
			};

			// Get conversation history
			const conversationHistory = this.memoryService.formatHistoryForContext();

			let populatedPrompt = systemPrompt
				.replace('{{repository_structure}}', repoStructure)
				.replace('{{cli_tools}}', cliTools);

			// Append conversation history if there is any
			if (conversationHistory) populatedPrompt += '\n\n' + conversationHistory;

			this.session.sendRealtimeInput({ text: populatedPrompt });
			console.log('System prompt sent.');

			// Log conversation stats
			const stats = this.memoryService.getStats();
			if (stats.totalMessages > 0)
				console.log(
					`Loaded conversation: ${stats.userMessages} user messages, ${stats.assistantMessages} assistant messages, ${stats.thoughts} thoughts`
				);
		} catch {
			console.log('No system prompt found or error loading it.');
		};
	};

	private logThought(role: ConversationEntry['role'], content: string): void {
		const timestamp = new Date().toISOString();
		const entry: ConversationEntry = { role, content, timestamp };
		this.thoughtLog.push(entry);

		fsp
			.writeFile(this.logFile, JSON.stringify(this.thoughtLog, null, 2))
			.catch((err) => console.error('Error saving thoughts:', err));
	};
};
