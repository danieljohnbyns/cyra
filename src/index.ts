
import { config } from './config.ts';
import { Server } from './services/Server.ts';

console.log('App Configuration:', config);

const server = new Server();

// Handle process exit
process.on('SIGINT', () => {
	console.log('Stopping...');
	server.close();
	process.exit(0);
});