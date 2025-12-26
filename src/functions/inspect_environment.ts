import { exec } from 'child_process';
import { promisify } from 'util';
import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types/index.d.ts';

const execAsync = promisify(exec);

const tool: CyraTool = {
	name: 'inspect_environment',
	description:
		'Inspects the current environment and returns information about available terminal commands, shell, and system details.',
	behavior: Behavior.BLOCKING,
	response: {
		type: Type.OBJECT,
		description:
			'Information about the environment including shell, available commands, and system details.'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			limit: {
				type: Type.INTEGER,
				description:
					'Optional: Maximum number of commands to return (default: 200). Set higher for comprehensive list.',
				default: 200
			}
		}
	},
	execute: async (args?: Record<string, unknown>) => {
		const limit = typeof args?.limit === 'number' ? args.limit : 200;

		// Get shell info
		let shellInfo = 'Unknown';
		try {
			const { stdout } = await execAsync('echo $SHELL');
			shellInfo = stdout.trim();
		} catch {
			shellInfo = 'Unable to determine';
		};

		// Get OS info
		let osInfo = 'Unknown';
		try {
			const { stdout } = await execAsync('uname -s');
			osInfo = stdout.trim();
		} catch {
			osInfo = 'Unknown';
		};

		// Get PATH
		let pathDirs: string[] = [];
		try {
			const pathEnv = process.env.PATH || '';
			pathDirs = pathEnv.split(':').filter((p) => p.length > 0);
		} catch {
			pathDirs = [];
		};

		// Dynamically discover all available commands
		let availableCommands: string[] = [];
		let commandCount = 0;

		// Try using compgen first (most efficient)
		try {
			const { stdout } = await execAsync(
				'compgen -c 2>/dev/null | head -n ' + limit,
				{
					shell: '/bin/bash'
				}
			);
			availableCommands = stdout
				.split('\n')
				.filter((cmd) => cmd.trim().length > 0)
				.map((cmd) => cmd.trim());
			commandCount = availableCommands.length;
		} catch {
			// Fallback: scan PATH directories directly
			try {
				const pathCommands: Map<string, string> = new Map();

				for (const dir of pathDirs) {
					try {
						const { stdout } = await execAsync(`ls -1 "${dir}" 2>/dev/null || true`);
						for (const f of stdout.split('\n')) {
							const trimmed = f.trim();
							if (trimmed.length > 0 && !pathCommands.has(trimmed))
								pathCommands.set(trimmed, dir);
						};

						// Stop if we've found enough commands
						if (pathCommands.size >= limit) break;
					} catch {
						// Skip directories we can't read
					};
				};

				availableCommands = Array.from(pathCommands.keys()).slice(0, limit);
				commandCount = availableCommands.length;
			} catch {
				availableCommands = [];
				commandCount = 0;
			};
		};

		// Get environment variables count
		const envVarCount = Object.keys(process.env).length;

		// Get current working directory
		const cwd = process.cwd();

		// Get Node.js version
		let nodeVersion = 'Unknown';
		try {
			const { stdout } = await execAsync('node --version');
			nodeVersion = stdout.trim();
		} catch {
			nodeVersion = 'Not available';
		};

		// Get npm version if available
		let npmVersion = 'Unknown';
		try {
			const { stdout } = await execAsync('npm --version');
			npmVersion = stdout.trim();
		} catch {
			npmVersion = 'Not available';
		};

		return JSON.stringify(
			{
				shell: shellInfo,
				os: osInfo,
				nodeVersion,
				npmVersion,
				currentWorkingDirectory: cwd,
				environmentVariablesCount: envVarCount,
				pathDirectories: pathDirs.length,
				availableCommands,
				commandsCount: commandCount,
				summary: {
					description: `${commandCount} commands available in PATH (limited to ${limit})`,
					shellDetails: shellInfo,
					osDetails: osInfo
				}
			},
			null,
			2
		);
	}
};

export default tool;
