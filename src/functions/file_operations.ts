import * as path from 'path';
import * as fs from 'fs/promises';
import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types/index.d.ts';

const tool: CyraTool = {
	name: 'file_operations',
	description:
		'Unified tool for file operations including create, read, update, and delete.',
	behavior: Behavior.BLOCKING,
	response: {
		type: Type.OBJECT,
		description: 'Result of the file operation.'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			operation: {
				type: Type.STRING,
				description:
					'The operation to perform: "create", "read", "update", or "delete".'
			},
			file_path: {
				type: Type.STRING,
				description: 'The relative path to the file. (e.g., src/utils/helper.ts)'
			},
			content: {
				type: Type.STRING,
				description:
					'The content to write to the file. Required for "create" and "update" operations.'
			}
		}
	},
	execute: async (args) => {
		const operation =
			typeof args?.operation === 'string' ? args.operation.toLowerCase() : null;
		const filePath = typeof args?.file_path === 'string' ? args.file_path : null;
		const content = typeof args?.content === 'string' ? args.content : undefined;

		if (!filePath) throw new Error('No file_path argument provided.');
		if (!operation)
			throw new Error(
				'No operation argument provided. Use "create", "read", "update", or "delete".'
			);

		const resolvedPath = path.resolve(process.cwd(), filePath);

		try {
			switch (operation) {
			case 'create': {
				if (content === undefined)
					throw new Error('No content argument provided for create operation.');
				const dirPath = path.dirname(resolvedPath);
				await fs.mkdir(dirPath, { recursive: true });
				await fs.writeFile(resolvedPath, content, 'utf-8');
				return `File created successfully at ${filePath}`;
			}

			case 'read': {
				const fileContent = await fs.readFile(resolvedPath, 'utf-8');
				return fileContent;
			}

			case 'update': {
				if (content === undefined)
					throw new Error('No content argument provided for update operation.');
				await fs.access(resolvedPath);
				await fs.writeFile(resolvedPath, content, 'utf-8');
				return `File updated successfully at ${filePath}`;
			}

			case 'delete': {
				await fs.access(resolvedPath);
				await fs.unlink(resolvedPath);
				return `File deleted successfully at ${filePath}`;
			}

			default:
				throw new Error(
					`Unknown operation: ${operation}. Use "create", "read", "update", or "delete".`
				);
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT')
				throw new Error(
					`Error performing ${operation} operation at ${filePath}: File not found.`
				);
			throw new Error(
				`Error performing ${operation} operation at ${filePath}: ${(err as Error).message}`
			);
		};
	}
};

export default tool;
