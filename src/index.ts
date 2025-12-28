import { spawn } from 'child_process';
import { config } from './config/index.ts';
import { Server } from './services/Server.ts';
import { logger } from './utils/logger.ts';

logger.log('App Configuration:', config);

/**
 * Check if dependencies are already installed
 */
const checkDependencies = (checkCommand: string, serverName: string): Promise<boolean> => {
	return new Promise((resolve) => {
		const childProcess = spawn('sh', ['-c', checkCommand], {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: '/bin/sh'
		});

		childProcess.on('close', (code: number) => {
			if (code === 0) {
				logger.success(`Dependencies already installed for ${serverName}`);
				resolve(true);
			} else {
				logger.info(`Dependencies not yet installed for ${serverName}, will run setup`);
				resolve(false);
			};
		});

		childProcess.on('error', () => {
			resolve(false);
		});
	});
};

/**
 * Run setup scripts for all configured MCP servers
 */
const runSetupScripts = async (): Promise<void> => {
	if (!config.mcp.enabled || config.mcp.servers.length === 0)
		return;

	const serversWithDeps = config.mcp.servers.filter((server) => server.dependencies);
	if (serversWithDeps.length === 0)
		return;

	logger.log(`Checking dependencies for ${serversWithDeps.length} server(s)...`);

	for (const serverConfig of serversWithDeps) {
		const { setup, check } = serverConfig.dependencies!;

		// If check command exists, use it to determine if setup is needed
		if (check && setup) {
			const dependenciesInstalled = await checkDependencies(check, serverConfig.name);
			if (!dependenciesInstalled)
				await runSetupScript(setup, serverConfig.name);
		} else if (setup)
			// If only setup exists, always run it
			await runSetupScript(setup, serverConfig.name);
	};
};

/**
 * Run a single setup script
 */
const runSetupScript = (script: string, serverName: string): Promise<void> => {
	return new Promise((resolve) => {
		logger.log(`Running setup script for ${serverName}: ${script}`);

		const childProcess = spawn('sh', ['-c', script], {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: '/bin/sh'
		});

		let stdout = '';
		let stderr = '';

		childProcess.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		childProcess.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		childProcess.on('close', (code: number) => {
			if (code === 0) {
				logger.success(`Setup script for ${serverName} completed successfully`);
				if (stdout.trim())
					logger.log(`  Output: ${stdout.trim()}`);
			} else {
				logger.warn(`Setup script for ${serverName} exited with code ${code}`);
				if (stderr.trim())
					logger.warn(`  Errors: ${stderr.trim()}`);
			};
			resolve();
		});

		childProcess.on('error', (error: Error) => {
			logger.warn(`Setup script for ${serverName} failed to run: ${error.message}`);
			resolve();
		});
	});
};

try {
	// Run all setup scripts first, before initializing server
	await runSetupScripts();

	// Initialize server after setup is complete
	const server = new Server();

	// Handle process exit
	process.on('SIGINT', () => {
		logger.log('Stopping...');
		server.close();
		process.exit(0);
	});
} catch (error) {
	logger.error('Failed to initialize application:', error);
	process.exit(1);
};