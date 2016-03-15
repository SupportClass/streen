'use strict';

const Q = require('q');
const log = require('./log');
const config = require('hi-config');
const server = require('../server');
const pubSock = server.pubSock;
const chat = require('tmi.js');
const USERNAME = config.get('username');
const EventEmitter2 = require('eventemitter2').EventEmitter2;
const emitter = new EventEmitter2({wildcard: true});

/* eslint-disable babel/new-cap */
const mainClient = new chat.client({
	connection: {
		reconnect: true,
		cluster: 'main'
	},
	identity: {
		username: USERNAME,
		password: config.get('password')
	}
});

const awsClient = new chat.client({
	connection: {
		reconnect: true,
		cluster: 'aws'
	},
	identity: {
		username: USERNAME,
		password: config.get('password')
	}
});
/* eslint-enable babel/new-cap */

module.exports = emitter;

module.exports.join = function () {
	return Q.all(mainClient.join(...arguments), awsClient.join(...arguments));
};

module.exports.part = function () {
	return Q.all(mainClient.part(...arguments), awsClient.part(...arguments));
};

module.exports.say = function () {
	return Q.all(mainClient.say(...arguments), awsClient.say(...arguments));
};

module.exports.timeout = function () {
	return Q.all(mainClient.timeout(...arguments), awsClient.timeout(...arguments));
};

module.exports.mods = function () {
	return Q.all(mainClient.mods(...arguments), awsClient.mods(...arguments));
};

module.exports.channels = mainClient.channels;

// Wait until we've defined module.exports before loading the Slack lib
const slack = require('./slack');

// Connect to Twitch Chat and listen for various events.
// Don't start the IPC server until we are connected to Twitch CHat.
let _initialized = false;
[mainClient, awsClient].forEach(client => {
	const oldEmit = client.emit;
	client.emit = function () {
		oldEmit(...arguments);
		emitter.emit(...arguments);
	};

	client.connect();
});

emitter
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

				module.exports.join(`#${channel}`);
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

	.on('join', (channel, username) => {
		if (username === USERNAME) {
			const channelNoPound = channel.replace('#', '');
			log.info('[twitch] Joined channel:', channelNoPound);
		}
	})

	.on('part', (channel, username) => {
		if (username === USERNAME) {
			const channelNoPound = channel.replace('#', '');
			log.info('[twitch] Parted channel:', channelNoPound);
		}
	})

	.on('chat', (channel, user, message) => {
		const channelNoPound = channel.replace('#', '');
		pubSock.send('chat', channelNoPound, user, message);
	})

	.on('subscription', onSubscription)

	.on('subanniversary', onSubscription)

	.on('timeout', (channel, username) => {
		const channelNoPound = channel.replace('#', '');
		pubSock.send('timeout', channelNoPound, username);
	})

	.on('clearchat', channel => {
		const channelNoPound = channel.replace('#', '');
		pubSock.send('clearchat', channelNoPound);
	});

// Formats subscription and subanniversary events before emitting them
function onSubscription(channel, username, months) {
	const channelNoPound = channel.replace('#', '');
	pubSock.send('subscription', {
		channel: channelNoPound,
		username,
		resub: Boolean(months),
		months: parseInt(months, 10),
		ts: Date.now()
	});
}
