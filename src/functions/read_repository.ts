import * as path from 'path';
import * as fs from 'fs/promises';
import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types';

const tool: CyraTool = {
	name: 'read_repository',
	description:
		"Provides an map of all files for this agent's code repository. Useful for understanding the project structure and locating files.",
	behavior: Behavior.NON_BLOCKING,
	response: {
		type: Type.OBJECT,
		description: 'A summary of the files in the repository.'
	},
	execute: async () => {
		const repoPath = path.resolve(process.cwd());
		const fileMap: Record<string, string[]> = {};
		const ignoredPaths = new Set(['.git']);

		// Parse .gitignore if it exists
		try {
			const gitignorePath = path.join(repoPath, '.gitignore');
			const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
			gitignoreContent.split('\n').forEach((line) => {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith('#')) {
					ignoredPaths.add(trimmed.replace(/\/$/, ''));
				}
			});
		} catch {
			// .gitignore doesn't exist, continue
		}

		const walkDir = async (dir: string) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (ignoredPaths.has(entry.name)) continue;

				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walkDir(fullPath);
				} else if (entry.isFile()) {
					const relativeDir = path.relative(repoPath, dir) || '.';
					if (!fileMap[relativeDir]) fileMap[relativeDir] = [];
					fileMap[relativeDir].push(entry.name);
				}
			}
		};

		await walkDir(repoPath);
		return { output: JSON.stringify(fileMap, null, 4) };
	}
};

export default tool;
