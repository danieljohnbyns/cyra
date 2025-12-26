import * as path from 'path';
import * as fs from 'fs/promises';
import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types/index.d.ts';

const tool: CyraTool = {
	name: 'read_repository',
	description:
		'Provides an map of all files for this agent\'s code repository. Useful for understanding the project structure and locating files.',
	behavior: Behavior.BLOCKING,
	response: {
		type: Type.OBJECT,
		description: 'A summary of the files in the repository.'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			read: {
				type: Type.BOOLEAN,
				description: 'Include contents of files in the response. Default is false.'
			}
		}
	},
	execute: async (args) => {
		const repoPath = path.resolve(process.cwd());
		const filePaths: string[] = [];
		const ignoredPaths = new Set(['.git']);

		// Parse .gitignore if it exists
		try {
			const gitignorePath = path.join(repoPath, '.gitignore');
			const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
			for (const line of gitignoreContent.split('\n')) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith('#'))
					ignoredPaths.add(trimmed.replace(/\/$/, ''));
			};
		} catch {
			// .gitignore doesn't exist, continue
		};

		const walkDir = async (dir: string) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				const relativePath = path.relative(repoPath, fullPath);

				// Check if the path should be ignored
				if ([...ignoredPaths].some((ignore) => relativePath.startsWith(ignore)))
					continue;

				if (entry.isDirectory()) await walkDir(fullPath);
				else if (entry.isFile()) filePaths.push(relativePath);
			};
		};

		await walkDir(repoPath);

		const includeContents = args?.read === true;
		const files: Record<string, string | null> = {};

		for (const filePath of filePaths) {
			if (!includeContents) {
				files[filePath] = null;
				continue;
			};
			try {
				const content = await fs.readFile(path.join(repoPath, filePath), 'utf-8');
				files[filePath] = content;
			} catch {
				files[filePath] = null; // Unable to read file
			};
		};

		return JSON.stringify(files, null, 2);
	}
};

export default tool;
