'use strict';

const log = require('./log');
const config = require('./config');
const server = require('../server');
const io = server.io;
const chat = require('tmi.js');
const USERNAME = config.get('twitch.username');

/* eslint-disable new-cap */
const chatClient = new chat.client({
	connection: {
		reconnect: true
	},
	identity: {
		username: USERNAME,
		password: config.get('twitch.password')
	}
});
/* eslint-enable new-cap */

module.exports = chatClient;

// Wait until we've defined module.exports before loading the Slack lib
const slack = require('./slack');

// Connect to Twitch Chat and listen for various events.
// Don't start the IPC server until we are connected to Twitch CHat.
let _initialized = false;
chatClient.connect();
chatClient
	.on('connected', () => {
		log.info('Connected to Twitch Chat');
		slack.status('I\'ve connected to Twitch Chat. So many voices…');

		if (_initialized) {
			// As of Oct 3, 2015, tmi.js does not automatically rejoin channels after a reconnect.
			// The below block forces tmi.js to rejoin all the desired channels after it connects.
			for (const channel in server.heartbeatTimeouts) {
				if (!{}.hasOwnProperty.call(server.heartbeatTimeouts, channel)) {
					continue;
				}

				chatClient.join(channel);
			}

			log.info('Rejoined %s channels.', Object.keys(server.heartbeatTimeouts).length);
		} else {
			_initialized = true;
		}
	})

	.on('disconnected', reason => {
		log.warn('[twitch] DISCONNECTED:', reason);
		slack.status('I\'ve disconnected from Twitch Chat. I will attempt to reconnect for as long as it takes.');
		io.emit('disconnected');
	})

	.on('reconnect', () => {
		log.info('[twitch] Attempting to reconnect...');
		slack.status('Attempting to reconnect…');
		io.emit('reconnect');
	})

	.on('join', (channel, username, fromSelf) => {
		if (fromSelf) {
			const channelNoPound = channel.replace('#', '');
			log.info('[twitch] Joined channel:', channelNoPound);
		}
	})

	.on('part', (channel, username, fromSelf) => {
		if (fromSelf) {
			const channelNoPound = channel.replace('#', '');
			log.info('[twitch] Parted channel:', channelNoPound);
		}
	})

	.on('chat', (channel, user, message) => {
		const channelNoPound = channel.replace('#', '');
		io.to(`channel:${channelNoPound}`).emit('chat', {
			channel: channelNoPound,
			user,
			message
		});
	})

	.on('subscription', (channel, username, method) => {
		handleSubscription({
			channel,
			username,
			method,
			months: 1
		});
	})

	.on('resub', (channel, username, months, message) => {
		handleSubscription({
			channel,
			username,
			months,
			message
		});
	})

	.on('cheer', (channel, userstate, message) => {
		const channelNoPound = channel.replace('#', '');
		io.to(`channel:${channelNoPound}`).emit('cheer', {
			channel: channelNoPound,
			userstate,
			message,
			ts: Date.now()
		});
	})

	.on('timeout', (channel, username) => {
		const channelNoPound = channel.replace('#', '');
		io.to(`channel:${channelNoPound}`).emit('timeout', {
			channel: channelNoPound,
			username
		});
	})

	.on('clearchat', channel => {
		const channelNoPound = channel.replace('#', '');
		io.to(`channel:${channelNoPound}`).emit('clearchat', channelNoPound);
	});

// Formats subscription and resub events before emitting them
function handleSubscription(data) {
	data.months = parseInt(data.months, 10);
	data.channel = data.channel.replace('#', '');
	data.resub = data.months > 1;
	data.ts = Date.now();
	io.to(`channel:${data.channel}`).emit('subscription', data);
}
