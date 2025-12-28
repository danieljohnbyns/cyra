import chalk from 'chalk';

export const logger = {
	log: (message: string, ...args: any[]) => {
		console.log(chalk.blue('ℹ'), message, ...args);
	},

	success: (message: string, ...args: any[]) => {
		console.log(chalk.green('✓'), message, ...args);
	},

	warn: (message: string, ...args: any[]) => {
		console.warn(chalk.yellow('⚠'), message, ...args);
	},

	error: (message: string, ...args: any[]) => {
		console.error(chalk.red('✗'), message, ...args);
	},

	info: (message: string, ...args: any[]) => {
		console.log(chalk.cyan('→'), message, ...args);
	},

	debug: (message: string, ...args: any[]) => {
		console.log(chalk.gray('◆'), message, ...args);
	},

	title: (message: string) => {
		console.log(chalk.bold.cyan('\n' + '='.repeat(50)));
		console.log(chalk.bold.cyan(message));
		console.log(chalk.bold.cyan('='.repeat(50) + '\n'));
	}
};
