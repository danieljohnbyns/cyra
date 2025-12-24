import * as path from 'path';
import * as fsp from 'fs/promises';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { config } from '../config.ts';
import type { CyraTool } from '../../types/index.d.ts';

export class ToolManager {
	private tools: CyraTool[] = [];
	private watcher: FSWatcher | null = null;
	private onReloadCallback: (() => void) | null = null;

	constructor() {}

	public async loadTools(): Promise<void> {
		console.log('Loading tools...');
		this.tools = [];
		const functionsPath = path.resolve(
			process.cwd(),
			config.system.functionsPath
		);

		try {
			const files = await fsp.readdir(functionsPath);
			for (const file of files)
				if (file.endsWith('') || file.endsWith('.js')) {
					const modulePath = path.join(functionsPath, file);
					// Cache busting for hot reload using query parameter
					const importPath = `file://${modulePath}?update=${Date.now()}`;

					try {
						const module = await import(importPath);
						if (module.default) {
							this.tools.push(module.default);
							console.log(`Loaded tool: ${module.default.name}`);
						};
					} catch (error) {
						console.error(`Error loading tool ${file}:`, error);
					};
				};
		} catch (error) {
			console.error('Error reading functions directory:', error);
		};
		console.log(`Total tools loaded: ${this.tools.length}`);
	};

	public getTools(): CyraTool[] {
		return this.tools;
	};

	public getTool(name: string): CyraTool | undefined {
		return this.tools.find((t) => t.name === name);
	};

	public watch(onReload: () => void): void {
		this.onReloadCallback = onReload;
		const functionsPath = path.resolve(
			process.cwd(),
			config.system.functionsPath
		);

		this.watcher = chokidar.watch(functionsPath, {
			ignored: /(^|[/\\])\../, // ignore dotfiles
			persistent: true,
			ignoreInitial: true
		});

		const handleReload = async (filePath: string) => {
			if (!filePath.endsWith('') && !filePath.endsWith('.js')) return;
			console.log(`File ${filePath} changed, reloading tools...`);
			await this.loadTools();
			if (this.onReloadCallback) this.onReloadCallback();
		};

		this.watcher.on('change', handleReload);
		this.watcher.on('add', handleReload);
		this.watcher.on('unlink', handleReload);
	};

	public stopWatching(): void {
		if (this.watcher) this.watcher.close();
	};
};
