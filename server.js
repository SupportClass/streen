'use strict';

const config = require('./lib/config');
const log = require('./lib/log');
const format = require('util').format;
const rpc = require('axon-rpc');
const axon = require('axon');
const rep = axon.socket('rep');
const pubSock = axon.socket('pub');
const rpcServer = new rpc.Server(rep);

let socketsBound = false;
const heartbeatTimeouts = {};
const PUB_PORT = config.get('pubPort');
const RPC_PORT = config.get('rpcPort');
const HEARTBEAT_TIMEOUT = 15 * 1000;

module.exports = {pubSock, rpcServer, heartbeatTimeouts};

// Wait until we've defined module.exports before loading the Twitch IRC and Slack libs
const chatClient = require('./lib/twitch_chat');
const slack = require('./lib/slack');

// Oh no
process.on('unhandledException', err => {
	log.error(err.stack);
	slack.status(format('I\'ve encountered an unhandled error, and will now exit:```%s```', err.stack));
	pubSock.send('crash', err);
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

chatClient.on('connected', () => {
	if (socketsBound) {
		pubSock.send('connected');
	} else {
		bindSockets();
	}
});

function bindSockets() {
	pubSock.bind(PUB_PORT);
	rep.bind(RPC_PORT);
	pubSock.send('connected');

	socketsBound = true;

	/**
	 * Join a Twitch chat channel.
	 * @param {String} channel - The name of the channel to join. Do not include a leading "#" character.
	 * @param {Function} fn - The callback to execute after successfully joining the channel.
	 */
	rpcServer.expose('join', (channel, fn) => {
		resetHeartbeat(channel);
		if (chatClient.channels.indexOf(channel) >= 0) {
			// Already in channel, invoke callback with the name
			fn(null, channel);
		} else {
			chatClient.join(channel).then(() => {
				fn(null, null);
			});
		}
	});

	/**
	 * Send a message to a Twitch chat channel as the user specified in the config file.
	 * @param {String} channel - The name of the channel to send a message to. Do not include a leading "#" character.
	 * @param {String} message - The message to send.
	 * @param {Function} fn - The callback to execute after successfully sending the message.
	 */
	rpcServer.expose('say', (channel, message, fn) => {
		chatClient.say(channel, message).then(() => {
			fn(null, null);
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
	rpcServer.expose('timeout', (channel, username, seconds, fn) => {
		chatClient.timeout(channel, username, seconds).then(() => {
			fn(null, null);
		});
	});

	/**
	 * Get the list of chat mods for a Twitch channel.
	 * @param {String} channel - The Twitch channel to get a list of chat mods from
	 * @param {Function} fn - The callback to execute after successfully obtaining the list of chat mods.
	 */
	rpcServer.expose('mods', (channel, fn) => {
		chatClient.mods(channel).then(mods => {
			fn(null, mods);
		});
	});

	/**
	 * Tell Streen that you wish for it to remain in this array of channels.
	 * @param {Array.<string>} channels - The array of channel names. Do not include leading "#" characters.
	 * @param {heartbeatCallback} fb - The callback to execute after the heartbeat has been registered.
	 */
	rpcServer.expose('heartbeat', (channels, fn) => {
		// If we're not in any of these channels, join them.
		channels.forEach(channel => {
			if (chatClient.channels.indexOf(channel) < 0) {
				chatClient.join(channel);
			}
		});

		channels.forEach(resetHeartbeat);
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

// Siphons must send a heartbeat every HEARTBEAT_TIMEOUT seconds.
// Otherwise, their channels are parted.
// A siphon can miss no more than one consecutive heartbeat.
function resetHeartbeat(channel) {
	clearTimeout(heartbeatTimeouts[channel]);
	heartbeatTimeouts[channel] = setTimeout(() => {
		log.info('Heartbeat expired for', channel);
		chatClient.part(channel).then(() => {
			clearTimeout(heartbeatTimeouts[channel]);
			delete heartbeatTimeouts[channel];
		});
	}, (HEARTBEAT_TIMEOUT * 2) + 1000);
}
