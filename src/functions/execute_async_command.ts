import { Type, Behavior } from '@google/genai';
import type { CyraTool } from '../../types/index.d.ts';
import { JobQueue, type Job } from '../services/JobQueue.ts';
import { v4 as uuidv4 } from 'uuid';

const tool: CyraTool = {
	name: 'execute_async_command',
	description:
		'Execute a long-running command asynchronously and receive progress updates. The command executes in the background while you continue to interact with the user.',
	behavior: Behavior.BLOCKING,
	response: {
		type: Type.OBJECT,
		description: 'Job submission confirmation with job ID for tracking progress'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			command: {
				type: Type.STRING,
				description: 'The shell command to execute'
			},
			description: {
				type: Type.STRING,
				description: 'A user-friendly description of what the command does'
			}
		},
		required: ['command']
	},
	execute: async (args?: Record<string, unknown>) => {
		const { command, description } = args || {};

		if (!command || typeof command !== 'string')
			throw new Error('Command is required and must be a string');

		const jobId = uuidv4().slice(0, 8);
		const jobQueue = JobQueue.getInstance();

		// Create the async job
		const job: Job = {
			id: jobId,
			execute: async () => {
				const { exec } = await import('child_process');
				const { promisify } = await import('util');
				const execAsync = promisify(exec);

				jobQueue.updateProgress(jobId, 10, 'Executing command...');

				const { stdout, stderr } = await execAsync(command as string);

				jobQueue.updateProgress(jobId, 90, 'Processing output...');

				return {
					success: true,
					stdout: stdout || '',
					stderr: stderr || '',
					description: description || 'Command executed'
				};
			}
		};

		// Submit the job - returns immediately
		await jobQueue.submitJob(job);

		return JSON.stringify({
			jobId,
			message: `Job submitted: ${description || command}`,
			status: 'queued',
			userMessage:
				'Your command is executing in the background. I will notify you when it completes or if there are any issues.'
		});
	}
};

export default tool;
