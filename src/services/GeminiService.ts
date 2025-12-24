/* eslint-disable no-undef */
import { GoogleGenAI, Modality } from '@google/genai';
import type {
	Session,
	LiveServerMessage,
	LiveServerToolCall
} from '@google/genai';
import { config } from '../config.ts';
import { ToolManager } from './ToolManager.ts';
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
	private thoughtLog: ConversationEntry[] = [];
	private logFile: string;

	constructor(toolManager: ToolManager) {
		this.client = new GoogleGenAI({ apiKey: config.google.apiKey });
		this.toolManager = toolManager;

		if (!fs.existsSync(path.resolve(process.cwd(), config.system.tmpDir)))
			fs.mkdirSync(path.resolve(process.cwd(), config.system.tmpDir), {
				recursive: true
			});

		this.logFile = path.join(
			process.cwd(),
			config.system.tmpDir,
			`cyra_thought_${Date.now()}.json`
		);
	}

	public async connect(onAudioData: AudioDataCallback): Promise<void> {
		if (this.session) await this.disconnect();

		this.session = await this.client.live.connect({
			model: config.google.model,
			config: {
				responseModalities: [Modality.AUDIO],
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
					if (err instanceof Error) {
						console.error('Gemini session error:', err.message);
					} else {
						console.error('Gemini session error:', err);
					}
				},
				onclose: (e: CloseEvent) => console.log('Gemini session closed.', e)
			}
		});

		await this.sendSystemPrompt();
	}

	public async disconnect(): Promise<void> {
		if (this.session) {
			this.session.close();
			this.session = null;
		}
	}

	public sendAudio(data: Buffer): void {
		if (!this.session) return;
		this.session.sendRealtimeInput({
			media: {
				data: data.toString('base64'),
				mimeType: 'audio/pcm;rate=16000'
			}
		});
	}

	private async handleMessage(
		message: LiveServerMessage,
		onAudioData: AudioDataCallback
	): Promise<void> {
		// Log thoughts
		if (message.serverContent?.modelTurn?.parts) {
			for (const part of message.serverContent.modelTurn.parts) {
				if (part.text) {
					this.logThought('assistant', part.text);
				}
			}
		}

		// Handle Tool Calls
		if (message.toolCall) {
			await this.handleToolCalls(message.toolCall);
		}

		// Handle Audio Output
		if (message.serverContent?.modelTurn?.parts) {
			for (const part of message.serverContent.modelTurn.parts) {
				if (
					part.inlineData?.mimeType &&
					part.inlineData.mimeType.startsWith('audio/pcm') &&
					part.inlineData.data
				) {
					const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
					onAudioData(audioBuffer);
				}
			}
		}
	}

	private async handleToolCalls(toolCall: LiveServerToolCall): Promise<void> {
		for (const functionCall of toolCall.functionCalls || []) {
			const toolName = functionCall.name;
			if (!toolName) {
				console.error('Tool call without a name received.');
				continue;
			}

			const tool = this.toolManager.getTool(toolName);
			console.log(`Tool \`${toolName}\` executed.`);

			if (!tool) {
				console.error(`Tool ${toolName} not found.`);
				continue;
			}
			try {
				const result = await tool.execute(functionCall.args || {});
				if ('error' in result) {
					console.error(result.error);
				} else {
					console.log(result.output);
				}

				this.session?.sendToolResponse({
					functionResponses: {
						id: functionCall.id || '',
						name: tool.name,
						response: result
					}
				});
			} catch (err) {
				console.error(`Error executing tool ${tool.name}:`, err);
			}
		}
	}

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
			}
			if (inspectEnv) {
				const res = await inspectEnv.execute({});
				if ('output' in res) cliTools = res.output;
			}

			const populatedPrompt = systemPrompt
				.replace('{{repository_structure}}', repoStructure)
				.replace('{{cli_tools}}', cliTools);

			this.session.sendRealtimeInput({ text: populatedPrompt });
			console.log('System prompt sent.');
		} catch {
			console.log('No system prompt found or error loading it.');
		}
	}

	private logThought(role: ConversationEntry['role'], content: string): void {
		const timestamp = new Date().toISOString();
		const entry: ConversationEntry = { role, content, timestamp };
		this.thoughtLog.push(entry);

		fsp
			.writeFile(this.logFile, JSON.stringify(this.thoughtLog, null, 2))
			.catch((err) => console.error('Error saving thoughts:', err));
	}
}
