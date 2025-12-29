/**
 * MCP (Model Context Protocol) Server Configuration
 * Defines which MCP servers to connect to and how
 */

export type MCPServerType = 'stdio' | 'sse' | 'streamable-http';

export interface MCPServerConfig {
	name: string;
	type: MCPServerType;
	// For STDIO servers (local)
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// For SSE servers (remote)
	url?: string;
	headers?: Record<string, string>;
	// Optional dependencies setup and check
	// check: shell command to check if dependencies are already installed
	// setup: shell command to run for initial setup
	setup?: string;
};

export interface MCPConfig {
	servers: MCPServerConfig[];
	enabled: boolean;
};

/**
 * Default MCP server configurations
 * Add or modify servers here to enable/disable them
 */
export const defaultMCPConfig: MCPConfig = {
	enabled: true,
	servers: [
		{
			name: 'filesystem',
			type: 'stdio',
			command: 'npx',
			args: [
				'-y',
				'@modelcontextprotocol/server-filesystem@latest',
				'/home/danieljohn/Desktop/cyra'
			]
		},
		{
			name: 'memory',
			type: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-memory@latest']
		},
		{
			name: 'thinking',
			type: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-sequential-thinking@latest']
		},
		{
			name: 'council',
			type: 'stdio',
			command: 'npx',
			args: ['-y', 'https://github.com/cyra-ai/council.git']
		}
	]
};

export default defaultMCPConfig;
