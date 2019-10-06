'use strict';

const config = require('./lib/config');
const log = require('./lib/log');
const format = require('util').format;
const app = require('express')();
const server = require('http').Server(app); // eslint-disable-line new-cap
const io = require('socket.io')(server);
const TwitchChatClient = require('./lib/twitch_chat');

app.get('/', (req, res) => {
	res.sendStatus(200);
});

const HEARTBEAT_TIMEOUT = 15 * 1000;
const authenticatedSockets = new WeakSet();

module.exports = {app, io, HEARTBEAT_TIMEOUT};

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
client.connect();

// register the twitch chat client to slack (if enabled)
slack.register(chatClient);

// Start the Socket.IO server now that everything else has completed
setupServer();

function setupServer() {
	io.on('connection', socket => {
		log.trace('Socket %s connected.', socket.id);

		socket.on('authenticate', (key, fn) => {
			log.debug('Socket %s authenticating with key "%s"', socket.id, key);

			if (authenticatedSockets.has(socket)) {
				log.debug('Already authenticated');
				fn('already authenticated');
				return;
			}

			if (key === config.get('secretKey')) {
				log.debug('Accepted key');
				setupAuthenticatedSocket(socket);
				fn(null);
			} else {
				log.info('Rejected key "%s"', key);
				fn('invalid key');
			}
		});
	});

	log.info('Socket.IO server initialized');

	server.listen(config.get('port'));
	log.info('Streen running on http://localhost:%s', config.get('port'));
}

function setupAuthenticatedSocket(socket) {
	authenticatedSockets.add(socket);

	// Join Queue maintained for join attempts that occur while connection to twitch is offline
	let joinQueue = [];

	/**
	 * Join a Twitch chat channel.
	 * @param {String} channel - The name of the channel to join. Do not include a leading "#" character.
	 * @param {Function} fn - The callback to execute after successfully joining the channel.
	 */
	socket.on('join', (channel, fn) => {
		const joinRequest = {channel, fn};

		// NOTE 2/1/2017: Rooms are only left when the socket itself is closed. Is this okay? Is this a leak?
		// Have the socket join the namespace for the channel in order to receive messages.
		const roomName = `channel:${channel}`;
		if (Object.keys(socket.rooms).indexOf(roomName) < 0) {
			log.trace('Socket %s joined room:', socket.id, roomName);
			socket.join(roomName);
		}

		if (client.connected) {
			log.debug('Socket %s requesting to join Twitch chat channel "%s"', socket.id, channel);
			handleJoin(joinRequest);
		} else {
			log.debug('Socket %s requesting to join Twitch chat channel "%s" (Queued)', socket.id, channel);
			joinQueue.push(joinRequest);
		}
	});

	// Flush join queue when connected to twitch
	chatClient.on('connected', () => {
		for (const joinRequest of joinQueue) {
			handleJoin(joinRequest);
		}

		joinQueue = [];
	});

	// Internal function to handle a join request.
	// A join request will be delayed if not connected to twitch.
	function handleJoin(joinRequest) {
		const {channel, fn} = joinRequest;

		client.resetHeartbeat(channel);

		if (chatClient.channels.indexOf(`#${channel}`) >= 0) {
			// Already in channel, invoke callback with the name
			fn(null, channel);
		} else {
			chatClient.join(channel).then(() => {
				fn(null, null);
			}).catch(error => {
				log.error(`Error attempting to join "${channel}" from join command.\n\t`, error);
				fn(error);
			});
		}
	}

	/**
	 * Send a message to a Twitch chat channel as the user specified in the config file.
	 * @param {String} channel - The name of the channel to send a message to. Do not include a leading "#" character.
	 * @param {String} message - The message to send.
	 * @param {Function} fn - The callback to execute after successfully sending the message.
	 */
	socket.on('say', (channel, message, fn) => {
		chatClient.say(channel, message).then(() => {
			fn(null, null);
		}).catch(error => {
			log.error(`Error attempting to "say" in channel "${channel}".\n\tMessage: ${message}\n\t`, error);
			fn(error);
		});
	});

	/**
	 * Timeout a user in a Twitch chat channel for a given number of seconds.
	 * @param {String} channel - The name of the channel to execute the timeout command in.
	 * Do not include a leading "#" character.
	 * @param {String} username - The name of the user to timeout.
	 * @param {Number} seconds - The number of seconds to time the user out for.
	 * @param {Function} fn - The callback to execute after successfully timing out the user.
	 */
	socket.on('timeout', (channel, username, seconds, fn) => {
		chatClient.timeout(channel, username, seconds).then(() => {
			fn(null, null);
		}).catch(error => {
			log.error(`Error attempting to timeout user "${username}" in channel "${channel}" for ${seconds} seconds.\n\t`, error);
			fn(error);
		});
	});

	/**
	 * Get the list of chat mods for a Twitch channel.
	 * @param {String} channel - The Twitch channel to get a list of chat mods from
	 * @param {Function} fn - The callback to execute after successfully obtaining the list of chat mods.
	 */
	socket.on('mods', (channel, fn) => {
		chatClient.mods(channel).then(mods => {
			fn(null, mods);
		}).catch(error => {
			log.error(`Error attempting to get list of mods in channel "${channel}".\n\t`, error);
			fn(error);
		});
	});

	/**
	 * Tell Streen that you wish for it to remain in this array of channels.
	 * @param {Array.<string>} channels - The array of channel names. Do not include leading "#" characters.
	 * @param {heartbeatCallback} fb - The callback to execute after the heartbeat has been registered.
	 */
	socket.on('heartbeat', (channels, fn) => {
		client.heartbeat(channels);
		fn(null, HEARTBEAT_TIMEOUT);
	});

	/**
	 * The type of callback to execute after a successful heartbeat request.
	 * @callback heartbeatCallback
	 * @param {Object} err - The error returned, if any.
	 * @param {Number} heartbeatTimeout - How long to wait (in milliseconds) before sending the next heartbeat.
	 * Heartbeats can be sent earlier or later if needed.
	 * A siphon has up to (heartbeatTimeout * 2 + 1000) milliseconds to
	 * send another heartbeat before it times out. In other words, it can only miss
	 * one consecutive heartbeat.
	 */
}
