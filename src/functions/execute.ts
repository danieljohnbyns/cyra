import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types/index.d.ts';

const execAsync = promisify(exec);

const tool: CyraTool = {
	name: 'execute',
	description:
		'Executes any command or script on the command-line in any repository or directory. Supports shell commands, TypeScript, JavaScript, Python, and any executable. Non-blocking, runs in subprocess.',
	behavior: Behavior.BLOCKING,
	response: {
		type: Type.OBJECT,
		description: 'Output or error from the executed command.'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			directory: {
				type: Type.STRING,
				description:
					'The working directory to execute the command in. (e.g., "." or "src/")'
			},
			command: {
				type: Type.STRING,
				description:
					'The command to execute. (e.g., "node script.js arg1 arg2" or "npm run build" or "python analyze.py")'
			}
		}
	},
	execute: async (args) => {
		const directory = typeof args?.directory === 'string' ? args.directory : '.';
		const command = typeof args?.command === 'string' ? args.command : null;

		if (!command) return { error: 'No command argument provided.' };

		const resolvedPath = path.resolve(process.cwd(), directory);

		try {
			// Execute the command asynchronously in a subprocess
			const { stdout, stderr } = await execAsync(command, {
				cwd: resolvedPath,
				maxBuffer: 1024 * 1024 * 10 // 10MB buffer
			});

			const output = stdout.trim() || stderr.trim();
			return { output };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return { error: `Failed to execute command: ${errorMessage}` };
		}
	}
};

export default tool;
