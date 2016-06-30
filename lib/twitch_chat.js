'use strict';

const log = require('./log');
const config = require('hi-config');
const server = require('../server');
const pubSock = server.pubSock;
const chat = require('tmi.js');
const USERNAME = config.get('username');

/* eslint-disable babel/new-cap */
const chatClient = new chat.client({
	connection: {
		reconnect: true
	},
	identity: {
		username: USERNAME,
		password: config.get('password')
	}
});
/* eslint-enable babel/new-cap */

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
				if (!server.heartbeatTimeouts.hasOwnProperty(channel)) {
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
		pubSock.send('disconnected');
	})

	.on('reconnect', () => {
		log.info('[twitch] Attempting to reconnect...');
		slack.status('Attempting to reconnect…');
		pubSock.send('reconnect');
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
		pubSock.send('chat', channelNoPound, user, message);
	})

	.on('subscription', onSubscription)

	.on('resub', onSubscription)

	.on('timeout', (channel, username) => {
		const channelNoPound = channel.replace('#', '');
		pubSock.send('timeout', channelNoPound, username);
	})

	.on('clearchat', channel => {
		const channelNoPound = channel.replace('#', '');
		pubSock.send('clearchat', channelNoPound);
	});

// Formats subscription and resub events before emitting them
function onSubscription(channel, username, months, message) {
	const channelNoPound = channel.replace('#', '');
	pubSock.send('subscription', {
		channel: channelNoPound,
		username,
		resub: Boolean(months),
		months: parseInt(months, 10),
		message,
		ts: Date.now()
	});
}
