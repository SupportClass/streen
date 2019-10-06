const log = require('./lib/log');
const config = require('./lib/config');
const format = require('util').format;
const TwitchChatClient = require('./lib/twitch_chat');
const {io, HEARTBEAT_TIMEOUT, setupServer} = require('./lib/server');

// Wait until we've defined module.exports before loading the Twitch IRC and Slack libs
const slack = (function () {
	if (config.get('slack.botToken')) {
		return require('./lib/slack');
	}

	// If the "slack" property is not present in the config, just return function stubs and do nothing.
	log.info('No "slack" property found in config.json, will not post status to Slack');
	return {
		status() {},
		register() {}
	};
})();

// Oh no
process.on('unhandledException', err => {
	log.error(err.stack);
	slack.status(format('I\'ve encountered an unhandled error, and will now exit:```%s```', err.stack));
	io.emit('crash', err);
	setTimeout(() => {
		process.exit(1);
	}, 1000);
});

process.on('SIGINT', () => {
	log.info('Exiting from SIGINT in one second');
	slack.status('I\'m exiting from a deliberate SIGINT. This was probably intentional.');
	setTimeout(() => {
		process.exit(0);
	}, 1000);
});

// Create the TwitchChatClient, restrieve the internal tmi client, and connect to twitch
const client = new TwitchChatClient(io, HEARTBEAT_TIMEOUT, slack.status.bind(slack));
const chatClient = client.chatClient;

// register the twitch chat client to slack (if enabled)
slack.register(chatClient);

const twitchClientConnected = client.connect();
const delayPromise = new Promise(resolve => {
	setTimeout(() => resolve(), 1000);
});

// Start the socket server after either connected to twitch, or after one second.
// Prevents race conditions on server restart.
Promise.race([twitchClientConnected, delayPromise]).then(
	() => setupServer(client),
	() => setupServer(client)
);
