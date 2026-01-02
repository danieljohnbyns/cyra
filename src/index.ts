import { spawn } from 'child_process';
import { config } from './config/index.ts';
import { Server } from './services/Server.ts';
import { logger } from './utils/logger.ts';
import fs from 'fs';
import path from 'path';

// Ensure tmp directory exists
const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir))
	fs.mkdirSync(tmpDir, { recursive: true });

logger.hierarchy.details('App Configuration', {
	mcp: config.mcp.enabled ? 'enabled' : 'disabled',
	port: config.system.port,
	model: config.google.model
});

/**
 * Run setup scripts for all configured MCP servers
 */
const runSetupScripts = async (): Promise<void> => {
	if (!config.mcp.enabled || config.mcp.servers.length === 0)
		return;

	const serversWithSetup = config.mcp.servers.filter((server) => server.setup);
	if (serversWithSetup.length === 0)
		return;

	logger.hierarchy.section('Setting up dependencies', serversWithSetup.map(s => s.name));

	for (const serverConfig of serversWithSetup)
		// If setup exists, run it
		// The setup script should handle checking if it needs to run
		if (serverConfig.setup)
			await runSetupScript(serverConfig.setup, serverConfig.name);
};

/**
 * Run a single setup script
 */
const runSetupScript = (script: string, serverName: string): Promise<void> => {
	return new Promise((resolve) => {
		logger.info(`Setting up ${serverName}...`);

		const childProcess = spawn('sh', ['-c', script], {
			stdio: ['pipe', 'inherit', 'inherit'],
			shell: '/bin/sh'
		});

		childProcess.on('close', (code: number) => {
			if (code === 0)
				logger.success(`Setup script for ${serverName} completed successfully`);
			else
				logger.warn(`Setup script for ${serverName} exited with code ${code}`);
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