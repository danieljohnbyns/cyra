import * as path from 'path';
import * as fs from 'fs/promises';
import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types';

const tool: CyraTool = {
	name: 'read_file',
	description: 'Reads the contents of a file from the repository.',
	behavior: Behavior.NON_BLOCKING,
	response: {
		type: Type.OBJECT,
		description: 'The contents of the requested file.'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			file_path: {
				type: Type.STRING,
				description: 'The relative path to the file to be read. (e.g., src/index.ts)'
			}
		}
	},
	execute: async (args) => {
		const filePath = args?.file_path;
		if (!filePath)
			return { error: 'No file_path argument provided.' };

		const resolvedPath = path.resolve(process.cwd(), filePath);
		try {
			const content = await fs.readFile(resolvedPath, 'utf-8');
			return { output: content };
		} catch (err) {
			return { error: `Error reading file at ${filePath}: ${(err as Error).message}` };
		};
	}
};

export default tool;
