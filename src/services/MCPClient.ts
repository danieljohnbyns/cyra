/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig, MCPConfig } from '../config/mcp.ts';
import { logger } from '../utils/logger.ts';

interface MCPServerInstance {
	config: MCPServerConfig;
	client?: Client;
	transport?: StdioClientTransport;
	process?: ChildProcess;
	tools: Tool[];
	initialized: boolean;
	requestId?: number;
	pendingRequests?: Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>;
};

export class MCPClient extends EventEmitter {
	private servers: Map<string, MCPServerInstance> = new Map();
	private config: MCPConfig;

	constructor(config: MCPConfig) {
		super();
		this.config = config;
	};

	/**
	 * Initialize all configured MCP servers
	 */
	public async initialize(): Promise<void> {
		if (!this.config.enabled) {
			logger.info('MCP is disabled in configuration');
			return;
		};

		const serverNames = this.config.servers.map(s => s.name);
		logger.hierarchy.section(`Initializing ${this.config.servers.length} MCP servers`, serverNames);

		for (const serverConfig of this.config.servers) {
			try {
				await this.initializeServer(serverConfig);
			} catch (error) {
				logger.hierarchy.report('error', `Failed to initialize MCP server "${serverConfig.name}"`, [
					error instanceof Error ? error.message : String(error)
				]);
			};
		};

		logger.hierarchy.report('success', 'MCP servers initialized', [
			`Total servers: ${this.getInitializedServersCount()}`
		]);
	};

	/**
	 * Initialize a single MCP server
	 */
	private async initializeServer(serverConfig: MCPServerConfig): Promise<void> {
		const instance: MCPServerInstance = {
			config: serverConfig,
			tools: [],
			initialized: false
		};

		try {
			if (serverConfig.type === 'stdio')
				await this.initializeStdioServer(instance);
			else if (serverConfig.type === 'sse' || serverConfig.type === 'streamable-http')
				await this.initializeSSEServer(instance);
			else
				throw new Error(`Unsupported server type: ${serverConfig.type}`);

			this.servers.set(serverConfig.name, instance);
		} catch (error) {
			throw new Error(
				`Failed to initialize ${serverConfig.type} server ${serverConfig.name}: ${error}`
			);
		};
	};

	/**
	 * Initialize a STDIO-based MCP server (local process)
	 */
	private async initializeStdioServer(instance: MCPServerInstance): Promise<void> {
		const { command, args, env } = instance.config;

		if (!command)
			throw new Error('STDIO server requires a command');

		return new Promise((resolve, reject) => {
			try {
				// Spawn the server process
				const spawnedProcess = spawn(command, args || [], {
					env: {
						...process.env,
						...env
					},
					stdio: ['pipe', 'pipe', 'pipe']
				});

				instance.process = spawnedProcess;
				instance.requestId = 0;
				instance.pendingRequests = new Map();

				let stderrOutput = '';

				// Handle stdout for JSON-RPC responses
				spawnedProcess.stdout?.on('data', (data: Buffer) => {
					const lines = data.toString().split('\n');
					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const response = JSON.parse(line);
							this.handleMCPResponse(instance, response);
						} catch {
							logger.debug(`Failed to parse MCP response from ${instance.config.name}`);
						};
					};
				});

				// Capture stderr for debugging
				spawnedProcess.stderr?.on('data', (data: Buffer) => {
					stderrOutput += data.toString();
				});

				// Handle process errors
				spawnedProcess.on('error', (error: Error) => {
					logger.hierarchy.report('error', `MCP server "${instance.config.name}" process error`, [error.message]);
				});

				spawnedProcess.on('exit', (code: number | null) => {
					logger.info(`MCP server "${instance.config.name}" exited with code ${code}`);
					if (stderrOutput)
						logger.debug(`MCP server stderr: ${stderrOutput}`);
					instance.initialized = false;
				});

				instance.initialized = true;
				logger.success(`Successfully initialized MCP server: ${instance.config.name}`);

				// Discover tools from the server
				this.discoverToolsStdio(instance).catch((error) => {
					logger.hierarchy.report('error', `Failed to discover tools for ${instance.config.name}`, [
						String(error)
					]);
				});

				resolve();
			} catch (error) {
				reject(error);
			};
		});
	};

	/**
	 * Handle JSON-RPC responses from MCP server
	 */
	private handleMCPResponse(instance: MCPServerInstance, response: any): void {
		if (response.id !== undefined && instance.pendingRequests) {
			const pending = instance.pendingRequests.get(response.id);
			if (pending) {
				instance.pendingRequests.delete(response.id);
				if (response.error)
					pending.reject(new Error(response.error.message || JSON.stringify(response.error)));
				else
					pending.resolve(response.result);
			};
		};
	};

	/**
	 * Send a JSON-RPC request to an MCP server
	 */
	private async sendMCPRequest(instance: MCPServerInstance, method: string, params?: any): Promise<any> {
		if (!instance.process || instance.requestId === undefined)
			throw new Error(`MCP server "${instance.config.name}" is not initialized`);

		const id = ++instance.requestId;
		const request = {
			jsonrpc: '2.0',
			id,
			method,
			...(params && { params })
		};

		return new Promise((resolve, reject) => {
			if (!instance.pendingRequests)
				instance.pendingRequests = new Map();

			// Longer timeout for tool execution (especially long-running operations)
			const timeoutMs = method === 'tools/call' ? 30000 : 10000;
			const timeout = setTimeout(() => {
				instance.pendingRequests?.delete(id);
				reject(new Error(`Request timeout for method ${method}`));
			}, timeoutMs);

			instance.pendingRequests.set(id, {
				resolve: (value) => {
					clearTimeout(timeout);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				}
			});

			instance.process?.stdin?.write(JSON.stringify(request) + '\n');
		});
	};

	/**
	 * Initialize a Streamable HTTP-based MCP server (remote HTTP)
	 */
	private async initializeSSEServer(instance: MCPServerInstance): Promise<void> {
		const { url, headers } = instance.config;

		if (!url)
			throw new Error('Streamable HTTP server requires a URL');

		try {
			// Initialize streamable HTTP transport
			instance.requestId = 0;
			instance.pendingRequests = new Map();

			// Store URL and headers for later use
			(instance as any).httpUrl = url;
			(instance as any).httpHeaders = headers || {};
			(instance as any).sessionId = undefined;

			// Test connection by sending initialize request
			const initResponse = await this.sendStreamableHTTPRequest(instance, 'initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: {
					name: 'cyra-mcp-client',
					version: '1.0.0'
				}
			}, true); // true = this is initialization

			if (!initResponse)
				throw new Error('No response from server during initialization');

			instance.initialized = true;
			logger.success(`Successfully initialized MCP server: ${instance.config.name}`);

			// Discover tools from the server
			await this.discoverToolsStreamableHTTP(instance);
		} catch (error) {
			logger.hierarchy.report('error', 'Failed to initialize Streamable HTTP server', [
				String(error)
			]);
			throw error;
		};
	};

	/**
	 * Send a request via Streamable HTTP transport
	 */
	private async sendStreamableHTTPRequest(
		instance: MCPServerInstance,
		method: string,
		params?: any,
		isInitialization: boolean = false
	): Promise<any> {
		const url = (instance as any).httpUrl;
		const defaultHeaders = (instance as any).httpHeaders || {};
		const sessionId = (instance as any).sessionId;

		if (!instance.requestId)
			instance.requestId = 0;

		const id = ++instance.requestId;
		const request = {
			jsonrpc: '2.0',
			id,
			method,
			...(params && { params })
		};

		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2025-06-18',
				...(defaultHeaders as Record<string, string>)
			};

			// Include session ID if available
			if (sessionId)
				headers['Mcp-Session-Id'] = sessionId;

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(request)
			});

			if (!response.ok)
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);

			// Capture session ID from response header if this is initialization
			if (isInitialization) {
				const respSessionId = response.headers.get('Mcp-Session-Id');
				if (respSessionId)
					(instance as any).sessionId = respSessionId;
			};

			// Check if response is SSE stream or JSON
			const contentType = response.headers.get('content-type');
			let result;
			if (contentType?.includes('text/event-stream'))
				result = await this.parseSSEResponse(response);
			else
				result = await response.json();

			// If the result is a JSON-RPC response with a result field, extract it
			if (result && typeof result === 'object' && 'result' in result && 'jsonrpc' in result)
				return result.result;

			return result;
		} catch (error) {
			logger.hierarchy.report('error', `Streamable HTTP request failed for ${instance.config.name}`, [
				String(error)
			]);
			throw error;
		};
	};

	/**
	 * Parse Server-Sent Events response
	 */
	private async parseSSEResponse(response: Response): Promise<any> {
		const reader = response.body?.getReader();
		if (!reader)
			throw new Error('No response body');

		const decoder = new TextDecoder();
		let buffer = '';
		const events: any[] = [];

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done)
					break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				let currentData = '';
				for (const line of lines) {
					if (!line.trim() || line.startsWith(':'))
						continue;

					if (line.startsWith('data: ')) {
						currentData = line.slice(6);
						try {
							const data = JSON.parse(currentData);
							events.push(data);
						} catch {
							logger.debug('Failed to parse SSE data');
						};
					};
				};
			};

			// Process any remaining buffer
			if (buffer.trim().startsWith('data: ')) {
				try {
					const data = JSON.parse(buffer.slice(6));
					events.push(data);
				} catch {
					// Ignore parse errors for remaining buffer
				};
			};
		} finally {
			reader.releaseLock();
		};

		// Return the last complete response or merge all events
		if (events.length > 0) {
			const lastEvent = events[events.length - 1];
			// If it's a complete JSON-RPC response, return it
			if (lastEvent.result !== undefined)
				return lastEvent.result;
			if (lastEvent.error !== undefined)
				throw new Error(lastEvent.error.message);
			// Otherwise return the last event
			return lastEvent;
		};

		return null;
	};

	/**
	 * Discover available tools from a Streamable HTTP server
	 */
	private async discoverToolsStreamableHTTP(instance: MCPServerInstance): Promise<void> {
		try {
			const response = await this.sendStreamableHTTPRequest(instance, 'tools/list');

			if (response && response.tools && Array.isArray(response.tools)) {
				instance.tools = response.tools.map((tool: any) => ({
					name: tool.name,
					description: tool.description || '',
					inputSchema: tool.inputSchema
				} as Tool));
				logger.hierarchy.list(
					`Discovered tools from ${instance.config.name}`,
					instance.tools.map(t => t.name),
					`Total: ${instance.tools.length}`
				);
			} else {
				logger.info(`No tools found in response from ${instance.config.name}`);
				instance.tools = [];
			};
		} catch (error) {
			logger.hierarchy.report('error', `Failed to discover tools from ${instance.config.name}`, [
				String(error)
			]);
			instance.tools = [];
		};
	};

	/**
	 * Discover available tools from a STDIO server
	 */
	private async discoverToolsStdio(instance: MCPServerInstance): Promise<void> {
		try {
			// Send tools/list request to the MCP server
			const response = await this.sendMCPRequest(instance, 'tools/list');

			if (response && response.tools && Array.isArray(response.tools)) {
				instance.tools = response.tools.map((tool: any) => ({
					name: tool.name,
					description: tool.description || '',
					inputSchema: tool.inputSchema
				} as Tool));
				logger.hierarchy.list(
					`Discovered tools from ${instance.config.name}`,
					instance.tools.map(t => t.name),
					`Total: ${instance.tools.length}`
				);
			} else {
				logger.info(`No tools found in response from ${instance.config.name}`);
				instance.tools = [];
			};
		} catch (error) {
			logger.hierarchy.report('error', `Failed to discover tools from ${instance.config.name}`, [
				String(error)
			]);
			instance.tools = [];
		};
	};

	/**
	 * Get all available tools from all initialized servers
	 */
	public getTools(): Tool[] {
		const tools: Tool[] = [];

		for (const server of this.servers.values())
			if (server.initialized)
				tools.push(...server.tools);

		return tools;
	};

	/**
	 * Get tool definitions in Gemini API format
	 */
	public getToolDefinitionsForGemini(): any[] {
		return this.getTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema || {
				type: 'object',
				properties: {}
			}
		}));
	};

	/**
	 * Execute a tool call on the appropriate MCP server
	 */
	public async executeTool(
		toolName: string,
		args?: Record<string, unknown>
	): Promise<string> {
		for (const server of this.servers.values()) {
			const tool = server.tools.find((t) => t.name === toolName);
			if (tool) {
				logger.info(`Executing tool "${toolName}" on server "${server.config.name}"`);
				try {
					let response;

					if (server.config.type === 'stdio')
						response = await this.sendMCPRequest(server, 'tools/call', {
							name: toolName,
							arguments: args || {}
						});
					else if (server.config.type === 'sse' || server.config.type === 'streamable-http')
						response = await this.sendStreamableHTTPRequest(server, 'tools/call', {
							name: toolName,
							arguments: args || {}
						});
					else
						throw new Error(`Unsupported server type: ${server.config.type}`);

					// Return the result as a JSON string
					return JSON.stringify(response);
				} catch (error) {
					throw new Error(`Failed to execute tool ${toolName}: ${(error as Error).message}`);
				};
			};
		};

		throw new Error(`Tool not found: ${toolName}`);
	};

	/**
	 * Get count of initialized servers
	 */
	public getInitializedServersCount(): number {
		return Array.from(this.servers.values()).filter((s) => s.initialized).length;
	};

	/**
	 * Get server by name
	 */
	public getServer(name: string): MCPServerInstance | undefined {
		return this.servers.get(name);
	};

	/**
	 * Get all servers
	 */
	public getAllServers(): MCPServerInstance[] {
		return Array.from(this.servers.values());
	};

	/**
	 * Shutdown all MCP servers
	 */
	public shutdown(): void {
		for (const server of this.servers.values())
			if (server.process)
				server.process.kill();

		this.servers.clear();
		logger.info('All MCP servers shut down');
	};
};

export default MCPClient;
