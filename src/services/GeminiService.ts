import { GoogleGenAI, Modality } from '@google/genai';
import type {
	Session,
	LiveServerMessage,
	LiveServerToolCall
} from '@google/genai';
import { config } from '../config.ts';
import { ToolManager } from './ToolManager.ts';
import { MemoryService } from './MemoryService.ts';
import { SessionStateManager } from './SessionStateManager.ts';
import { JobQueue, type JobProgress } from './JobQueue.ts';
import type {
	ConversationEntry,
	AudioDataCallback
} from '../../types/gemini.d.ts';
import type { CyraTool } from '../../types/index.d.ts';
import { withRetry } from '../utils/withRetry.ts';
import { withTimeout } from '../utils/withTimeout.ts';
import { formatErrorForUser } from '../utils/errorRecovery.ts';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';

export class GeminiService {
	private client: GoogleGenAI;
	private session: Session | null = null;
	private toolManager: ToolManager;
	private memoryService: MemoryService;
	private sessionStateManager: SessionStateManager;
	private jobQueue: JobQueue;
	private thoughtLog: ConversationEntry[] = [];
	private logFile: string;

	constructor(toolManager: ToolManager) {
		this.client = new GoogleGenAI({ apiKey: config.google.apiKey });
		this.toolManager = toolManager;
		this.memoryService = new MemoryService();
		this.sessionStateManager = new SessionStateManager(
			path.resolve(process.cwd(), config.system.tmpDir)
		);
		this.jobQueue = JobQueue.getInstance();

		// Listen for job events and send updates to user
		this.jobQueue.on('job:progress', (job) => {
			this.sendProgressUpdate(job);
		});
		this.jobQueue.on('job:completed', (job) => {
			this.sendJobCompletion(job);
		});
		this.jobQueue.on('job:failed', (job) => {
			this.sendJobFailure(job);
		});

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

	/**
	 * Check if session was interrupted and offer recovery
	 */
	public async checkForInterruption(): Promise<boolean> {
		const wasInterrupted = await this.sessionStateManager.wasInterrupted();
		if (wasInterrupted) {
			const previousState = await this.sessionStateManager.loadState();
			console.log('Previous session was interrupted:', previousState);
			return true;
		};
		return false;
	};

	public async connect(onAudioData: AudioDataCallback): Promise<void> {
		if (this.session) await this.disconnect();

		// Save session state before connecting
		await this.saveSessionState('connecting');

		// Build system instruction with dynamic context
		const systemInstructionText = await this.buildSystemInstruction();

		this.session = await this.client.live.connect({
			model: config.google.model,
			config: {
				systemInstruction: {
					parts: [
						{
							text: systemInstructionText
						}
					]
				},
				responseModalities: [Modality.AUDIO],
				inputAudioTranscription: {},
				outputAudioTranscription: {},
				tools: [{ functionDeclarations: this.toolManager.getTools() }]
			},
			callbacks: {
				onopen: () => {
					console.log('Gemini session connected.');
					this.saveSessionState('connected').catch((err) =>
						console.error('Failed to save session state:', err)
					);
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

		// Log conversation stats
		const stats = this.memoryService.getStats();
		if (stats.totalMessages > 0)
			console.log(
				`Loaded conversation: ${stats.userMessages} user messages, ${stats.assistantMessages} assistant messages, ${stats.thoughts} thoughts`
			);

		// Send introduction prompt to AI after connection is established
		setTimeout(() => {
			this.sendIntroductionPrompt();
		}, 500);
	};

	public async disconnect(): Promise<void> {
		if (this.session) {
			this.session.close();
			this.session = null;
		};
		// Do not close memory service here as it might be needed for reconnection
		// this.memoryService.close();

		// Clear session state on successful disconnect
		await this.clearSessionState();
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

	/**
	 * Inject semantically relevant memories into the session for context
	 * Called periodically to enhance AI understanding with past interactions
	 */
	public async injectSemanticContext(query: string): Promise<void> {
		if (!this.session) return;

		try {
			// Search for semantically similar past interactions
			const relevantMemories = await this.memoryService.searchMemory(
				query,
				3, // Top 3 most relevant
				0.4 // Minimum similarity threshold
			);

			if (relevantMemories.length === 0) return;

			// Format relevant memories for injection
			let contextMessage = '## Relevant Past Interactions (For Context)\n\n';
			for (const memory of relevantMemories) {
				const role = memory.role === 'thought' ? 'internal_thought' : memory.role;
				contextMessage += `[${role.toUpperCase()}] ${memory.content.substring(0, 200)}...\n`;
			};

			// Send as internal context (text, not audio)
			this.session.sendRealtimeInput({ text: contextMessage });
		} catch (error) {
			console.error('Error injecting semantic context:', error);
		};
	};

	/**
	 * Send introduction prompt to AI when session starts
	 * Prompts AI to introduce itself and optionally read previous session notes
	 */
	private async sendIntroductionPrompt(): Promise<void> {
		if (!this.session) return;

		try {
			// Check if there are previous session notes
			const previousNotes = await this.loadPreviousSessionNotes();

			// Build the introduction prompt
			let introPrompt = 'Please introduce yourself briefly.';

			if (previousNotes)
				introPrompt += ` Here are notes from our last session:\n\n${previousNotes}`;

			// Send the introduction request as text
			this.session.sendRealtimeInput({
				text: introPrompt
			});

			console.log('Introduction prompt sent to AI.');
		} catch (error) {
			console.error('Error sending introduction prompt:', error);
		};
	};

	/**
	 * Load notes from the most recent previous session
	 */
	private async loadPreviousSessionNotes(): Promise<string | null> {
		try {
			const tmpDir = path.resolve(process.cwd(), config.system.tmpDir);

			// Get all thought log files
			const files = await fsp.readdir(tmpDir);
			const thoughtFiles = files
				.filter(
					(f) =>
						f.startsWith('cyra_thought_') && f.endsWith('.json') && f !== path.basename(this.logFile)
				)
				.sort()
				.reverse();

			if (thoughtFiles.length === 0) return null;

			// Read the most recent thought log
			const latestFile = path.join(tmpDir, thoughtFiles[0]);
			const content = await fsp.readFile(latestFile, 'utf-8');
			const thoughtLog = JSON.parse(content);

			// Extract key points from the thought log
			if (Array.isArray(thoughtLog) && thoughtLog.length > 0) {
				// Get last 5 entries as summary
				const recentEntries = thoughtLog.slice(-5);
				const summary = recentEntries
					.map((entry: ConversationEntry) => {
						if (entry.role === 'user') return `User: ${entry.content.substring(0, 100)}...`;
						if (entry.role === 'assistant') return `You: ${entry.content.substring(0, 100)}...`;
						if (entry.role === 'thought')
							return `Internal thought: ${entry.content.substring(0, 80)}...`;
						return null;
					})
					.filter((s) => s !== null)
					.join('\n');

				return summary || null;
			};

			return null;
		} catch (error) {
			console.error('Error loading previous session notes:', error);
			return null;
		};
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

				// Inject semantically relevant context based on user query
				this.injectSemanticContext(transcript).catch((err) =>
					console.error('Error injecting semantic context:', err)
				);
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
		const functionResponses: unknown[] = [];

		for (const functionCall of toolCall.functionCalls || []) {
			const toolName = functionCall.name;
			if (!toolName) {
				console.error('Tool call without a name received.');
				continue;
			};

			const tool = this.toolManager.getTool(toolName) as CyraTool | null;
			console.log(`Tool \`${toolName}\` requested.`);

			if (!tool) {
				console.error(`Tool ${toolName} not found.`);
				functionResponses.push({
					id: functionCall.id || '',
					name: toolName,
					response: {
						error: `Tool ${toolName} not found`
					}
				});
				continue;
			};

			try {
				// Execute tool with retry and timeout
				const output = await this.executeToolWithResilience(
					tool,
					functionCall.args || {},
					tool.required !== false
				);

				console.log(`Tool ${toolName} output:`, output);

				functionResponses.push({
					id: functionCall.id || '',
					name: toolName,
					response: { output }
				});
			} catch (err) {
				console.error(`Error executing tool ${toolName}:`, err);
				const isRequired = tool.required !== false;
				const { message: formattedMessage, shouldContinue } = formatErrorForUser(
					err,
					toolName,
					isRequired
				);

				// Notify user of error
				if (!shouldContinue)
					this.session?.sendRealtimeInput({
						text: `Critical error: ${formattedMessage}`
					});
				else this.session?.sendRealtimeInput({ text: formattedMessage });

				// Add error response
				functionResponses.push({
					id: functionCall.id || '',
					name: toolName,
					response: {
						error: formattedMessage
					}
				});
			};
		};

		// Send all responses back to Gemini
		if (functionResponses.length > 0)
			this.session?.sendToolResponse({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				functionResponses: functionResponses as any
			});
	};

	/**
	 * Execute tool with retry and timeout resilience
	 */
	private async executeToolWithResilience(
		tool: CyraTool,
		args: Record<string, unknown>,
		_isRequired: boolean
	): Promise<string> {
		const toolName = tool.name || 'unknown';
		const timeoutMs =
			tool.timeoutMs || config.errorHandling.timeout.defaultTimeoutMs;

		// Wrap execution with retry logic
		return await withRetry(
			() => withTimeout(tool.execute(args), timeoutMs, `Tool ${toolName}`),
			config.errorHandling.retry,
			`Tool ${toolName}`
		);
	};

	private async buildSystemInstruction(): Promise<string> {
		const systemPromptPath = path.resolve(process.cwd(), 'SystemPrompt.md');
		let basePrompt =
			'You are Cyra, an advanced AI assistant designed to help developers.';

		try {
			basePrompt = await fsp.readFile(systemPromptPath, 'utf-8');
		} catch {
			console.log('No SystemPrompt.md found, using default prompt.');
		};

		// Dynamic context injection
		const readRepo = this.toolManager.getTool('read_repository');
		const inspectEnv = this.toolManager.getTool('inspect_environment');

		let repoStructure = 'Not available';
		let cliTools = 'Not available';

		if (readRepo) {
			try {
				repoStructure = await readRepo.execute({});
			} catch (err) {
				console.error('Failed to read repository structure:', err);
			};
		};
		if (inspectEnv) {
			try {
				cliTools = await inspectEnv.execute({});
			} catch (err) {
				console.error('Failed to inspect environment:', err);
			};
		};

		// Get conversation history
		const conversationHistory = this.memoryService.formatHistoryForContext();

		// Build the complete system instruction
		let systemInstruction = basePrompt
			.replace('{{repository_structure}}', repoStructure)
			.replace('{{cli_tools}}', cliTools);

		// Append conversation history if there is any
		if (conversationHistory) systemInstruction += '\n\n' + conversationHistory;

		return systemInstruction;
	};

	private logThought(role: ConversationEntry['role'], content: string): void {
		const timestamp = new Date().toISOString();
		const entry: ConversationEntry = { role, content, timestamp };
		this.thoughtLog.push(entry);

		fsp
			.writeFile(this.logFile, JSON.stringify(this.thoughtLog, null, 2))
			.catch((err) => console.error('Error saving thoughts:', err));
	};

	/**
	 * Send progress update to user via audio
	 */
	private sendProgressUpdate(job: JobProgress): void {
		if (!this.session) return;

		const message = `Job ${job.jobId}: ${job.progress}% - ${job.message}`;
		console.log(`[PROGRESS] ${message}`);

		// Send as text to be read aloud
		this.session.sendRealtimeInput({ text: message });
		this.memoryService.addThought(`Job progress: ${message}`);
	};

	/**
	 * Send job completion to user
	 */
	private sendJobCompletion(job: JobProgress): void {
		if (!this.session) return;

		const message = `Job ${job.jobId} completed successfully. ${job.message}`;
		console.log(`[COMPLETED] ${message}`);

		// Send result summary
		this.session.sendRealtimeInput({ text: message });
		this.memoryService.addThought(`Job completed: ${message}`);
	};

	/**
	 * Send job failure to user
	 */
	private sendJobFailure(job: JobProgress): void {
		if (!this.session) return;

		const message = `Job ${job.jobId} failed: ${job.error}`;
		console.log(`[FAILED] ${message}`);

		// Send error message
		this.session.sendRealtimeInput({ text: message });
		this.memoryService.addThought(`Job failed: ${message}`);
	};

	/**
	 * Get job queue instance for tools to use
	 */
	public getJobQueue(): JobQueue {
		return this.jobQueue;
	};

	/**
	 * Save current session state for crash recovery
	 */
	private async saveSessionState(activity: string): Promise<void> {
		try {
			const stats = this.memoryService.getStats();
			await this.sessionStateManager.saveState({
				timestamp: new Date().toISOString(),
				toolsLoaded: this.toolManager
					.getTools()
					.map((t) => t.name)
					.filter((name): name is string => name !== undefined),
				messageCount: stats.totalMessages,
				lastActivity: activity
			});
		} catch (error) {
			console.error('Failed to save session state:', error);
		};
	};

	/**
	 * Restore session after crash and clear state
	 */
	public async clearSessionState(): Promise<void> {
		await this.sessionStateManager.clearState();
	};
};
