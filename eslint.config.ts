// Ignore this file, I configure it to my liking
// MY PROJECT MY RULES

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import type { Linter } from 'eslint';

const customRule: any = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Enforce semicolons after control structures with multiple statements',
			recommended: true
		},
		fixable: 'code',
		messages: {
			missingSemicolon:
				'Missing semicolon after closing brace of multi-statement block'
		}
	},
	create: (context: {
		sourceCode: any;
		report: (arg0: {
			node: any;
			messageId: string;
			fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) => any;
		}) => void;
	}) => {
		const sourceCode = context.sourceCode;

		const checkControlStructure = (node: any) => {
			const body = node.consequent || node.body;
			// Check if the body is a BlockStatement (single or multiple statements)
			if (body?.type === 'BlockStatement' && body.body?.length >= 1) {
				const tokens = sourceCode.getTokens(node);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}

		// For IfStatements, also check the else block (alternate)
		if (node.type === 'IfStatement' && node.alternate) {
			const alternate = node.alternate;
			// Only check if it's a BlockStatement (else { ... }), not else if
			if (alternate?.type === 'BlockStatement' && alternate.body?.length >= 1) {
				const tokens = sourceCode.getTokens(alternate);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node: alternate,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		}
	};

		const checkTryStatement = (node: any) => {
			// TryStatement has block, handler, and finalizer properties
			// Check the last child (could be finalizer or handler)
			const tokens = sourceCode.getTokens(node);
			const lastToken = tokens[tokens.length - 1];

			if (lastToken && lastToken.value === '}') {
				const nextToken = sourceCode.getTokenAfter(lastToken);
				if (!nextToken || nextToken.value !== ';') {
					context.report({
						node,
						messageId: 'missingSemicolon',
						fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
							fixer.insertTextAfter(lastToken, ';')
					});
				}
			}
		};

		const checkFunctionDeclaration = (node: any) => {
			const body = node.body;
			// Check if the body is a BlockStatement (single or multiple statements)
			if (body?.type === 'BlockStatement' && body.body?.length >= 1) {
				const tokens = sourceCode.getTokens(body);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		};

		const checkMethodDefinition = (node: any) => {
			const body = node.value?.body;
			// Check if the body is a BlockStatement (single or multiple statements)
			if (body?.type === 'BlockStatement' && body.body?.length >= 1) {
				const tokens = sourceCode.getTokens(body);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		};

		const checkClassDeclaration = (node: any) => {
			const body = node.body;
			// Class body is always a ClassBody with body array
			if (body?.type === 'ClassBody' && body.body?.length >= 0) {
				const tokens = sourceCode.getTokens(node);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		};

		const checkWithStatement = (node: any) => {
			const body = node.body;
			if (body?.type === 'BlockStatement' && body.body?.length >= 1) {
				const tokens = sourceCode.getTokens(node);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		};

		const checkArrowFunctionExpression = (node: any) => {
			const body = node.body;
			// Only check if body is a BlockStatement (not expression body)
			// AND if the arrow function is part of a variable declaration or export
			// (not a callback argument to another function)
			const parent = node.parent;
			const isVariableDeclaration = parent?.type === 'VariableDeclarator';
			const isExportDeclaration = parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration';
			const isAssignment = parent?.type === 'AssignmentExpression';

			// Only enforce semicolon if it's a statement-like context
			if ((isVariableDeclaration || isExportDeclaration || isAssignment) && 
				body?.type === 'BlockStatement' && 
				body.body?.length >= 1) {
				const tokens = sourceCode.getTokens(body);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		};

		const checkFunctionExpression = (node: any) => {
			const body = node.body;
			// Similar check for function expressions - only enforce semicolon in statement contexts
			const parent = node.parent;
			const isVariableDeclaration = parent?.type === 'VariableDeclarator';
			const isExportDeclaration = parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration';
			const isAssignment = parent?.type === 'AssignmentExpression';

			if ((isVariableDeclaration || isExportDeclaration || isAssignment) && 
				body?.type === 'BlockStatement' && 
				body.body?.length >= 1) {
				const tokens = sourceCode.getTokens(body);
				const lastToken = tokens[tokens.length - 1];

				if (lastToken && lastToken.value === '}') {
					const nextToken = sourceCode.getTokenAfter(lastToken);
					if (!nextToken || nextToken.value !== ';') {
						context.report({
							node,
							messageId: 'missingSemicolon',
							fix: (fixer: { insertTextAfter: (arg0: any, arg1: string) => any }) =>
								fixer.insertTextAfter(lastToken, ';')
						});
					}
				}
			}
		};

		return {
			'IfStatement:exit': checkControlStructure,
			'ForStatement:exit': checkControlStructure,
			'ForInStatement:exit': checkControlStructure,
			'ForOfStatement:exit': checkControlStructure,
			'WhileStatement:exit': checkControlStructure,
			'DoWhileStatement:exit': checkControlStructure,
			'TryStatement:exit': checkTryStatement,
			'SwitchStatement:exit': checkControlStructure,
			'FunctionDeclaration:exit': checkFunctionDeclaration,
			'MethodDefinition:exit': checkMethodDefinition,
			'ClassDeclaration:exit': checkClassDeclaration,
			'WithStatement:exit': checkWithStatement,
			'ArrowFunctionExpression:exit': checkArrowFunctionExpression,
			'FunctionExpression:exit': checkFunctionExpression
		};
	}
};

const unnecesaryCurlyRule: any = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Remove unnecessary curly braces for single-statement blocks',
			recommended: true
		},
		fixable: 'code',
		messages: {
			unnecessaryBraces:
				'Unnecessary curly braces for single-statement block. Remove them.'
		}
	},
	create: (context: any) => {
		const checkSingleStatement = (node: any) => {
			const body = node.consequent || node.body;
			// Check if body is a block with a single statement
			if (body?.type === 'BlockStatement' && body.body?.length === 1) {
				context.report({
					node: body,
					messageId: 'unnecessaryBraces'
				});
			}
		};

		return {
			'IfStatement:exit': checkSingleStatement,
			'ForStatement:exit': checkSingleStatement,
			'ForInStatement:exit': checkSingleStatement,
			'ForOfStatement:exit': checkSingleStatement,
			'WhileStatement:exit': checkSingleStatement,
			'DoWhileStatement:exit': checkSingleStatement
		};
	}
};

const config: Linter.Config[] = [
	{
		ignores: ['dist', 'node_modules', '*.js', '**/*.js']
	},
	{
		files: ['src/**/*.ts', 'src/**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
				project: './tsconfig.json'
			},
			globals: {
				console: 'readonly',
				process: 'readonly'
			}
		},
		plugins: {
			'@typescript-eslint': tsPlugin as any,
			custom: {
				rules: {
					'semicolon-after-control': customRule,
					'no-unnecessary-braces': unnecesaryCurlyRule
				}
			}
		},
		rules: {
			...js.configs.recommended.rules,
			...tsPlugin.configs.recommended.rules,
			'@typescript-eslint/explicit-module-boundary-types': 'warn',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'no-console': 'off',
			semi: ['error', 'always'],
			quotes: ['error', 'single'],
			indent: ['error', 'tab'],
			'comma-dangle': ['error', 'never'],
			curly: 'off',
			'custom/no-unnecessary-braces': 'error',
			'no-trailing-spaces': 'error',
			'custom/semicolon-after-control': 'error',
			'func-style': ['error', 'expression']
		}
	}
];

export default config;
