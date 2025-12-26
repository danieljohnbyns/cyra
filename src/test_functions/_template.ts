import { Type, Behavior } from '@google/genai';

import type { CyraTool } from '../../types/index';

const tool: CyraTool = {
	name: 'template',
	description:
		'This is a template function. Replace this description with the actual function purpose.',
	behavior: Behavior.BLOCKING,
	response: {
		type: Type.STRING,
		description: 'A summary of the files in the repository.'
	},
	parameters: {
		type: Type.OBJECT,
		properties: {
			param: {
				type: Type.BOOLEAN,
				description: 'A sample boolean parameter. Replace with actual parameters as needed.'
			}
		}
	},
	execute: async (args) => {
		if (args?.param !== true)
			throw new Error('Parameter "param" must be true.');

		return 'Template function executed successfully.';
	}
};

export default tool;
