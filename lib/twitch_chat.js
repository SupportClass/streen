'use strict';

const log = require('./log');
const config = require('./config');
const chat = require('tmi.js');
const USERNAME = config.get('twitch.username');

/**
 * Represents an encapsulation of a tmi.js chat client and an associated socket.io server
 * on which to send messages.
 */
class TwitchChatClient {
	constructor(io, HEARTBEAT_TIMEOUT) {
		this.io = io;
		this.heartbeatTimeouts = {};
		this.HEARTBEAT_TIMEOUT = HEARTBEAT_TIMEOUT;

		// Used to track mystery giftsubs
		this.giftsubTracking = {};

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
		this.chatClient = chatClient;
		/* eslint-enable new-cap */

		const slack = require('./slack');

		// Connect to Twitch Chat and listen for various events.
		// Don't start the IPC server until we are connected to Twitch CHat.
		let _initialized = false;
		chatClient
			.on('connected', () => {
				log.info('Connected to Twitch Chat');
				slack.status('I\'ve connected to Twitch Chat. So many voices…');

				if (_initialized) {
					// As of Oct 3, 2015, tmi.js does not automatically rejoin channels after a reconnect.
					// The below block forces tmi.js to rejoin all the desired channels after it connects.
					for (const channel in this.heartbeatTimeouts) {
						if (!{}.hasOwnProperty.call(this.heartbeatTimeouts, channel)) {
							continue;
						}

						chatClient.join(channel);
					}

					log.info('Rejoined %s channels.', Object.keys(this.heartbeatTimeouts).length);
				} else {
					_initialized = true;
				}

				io.emit('connected');
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
				this._handleSubscription({
					channel,
					username,
					method,
					months: 1
				});
			})

			.on('resub', (channel, username, months, message, userstate, method) => {
				// note: even though this is a resub, if months <= 1, it won't be treated as such.
				// This is part of the existing behavior and isn't something we can really change.
				this._handleSubscription({
					channel,
					username,
					method,
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
			})

			.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
				const channelNoPound = channel.replace('#', '');
				const senderCount = ~~userstate['msg-param-sender-count'];
				const key = `${channelNoPound}:${username}`;

				// Add an entry to giftsub tracking so that we ignore followup subgift entries
				this.giftsubTracking[key] = {
					channel: channelNoPound,
					username,
					amount: senderCount,
					method: methods,
					recipients: []
				};

				io.to(`channel:${channelNoPound}`).emit('submysterygift', {
					channel: channelNoPound,
					username,
					amount: senderCount
				});
			})

			.on('subgift', (channel, username, streakMonths, recipient, methods) => {
				const channelNoPound = channel.replace('#', '');
				const key = `${channelNoPound}:${username}`;

				if (key in this.giftsubTracking) {
					// add to the existing tracked giftsubs if already tracking
					const entry = this.giftsubTracking[key];
					entry.recipients.push(recipient);
					if (entry.recipients.length >= entry.amount) {
						io.to(`channel:${channelNoPound}`).emit('submysterygiftcomplete', entry);
						delete this.giftsubTracking[key];
					}
				} else {
					io.to(`channel:${channelNoPound}`).emit('subgift', {
						channel: channelNoPound,
						username,
						recipient,
						months: streakMonths,
						resub: streakMonths > 1,
						method: methods,
						ts: Date.now()
					});
				}
			});
	}

	/**
	 * Processes a raw twitch message.
	 * Can be used to replay a past event, mostly for testing
	 * @param {*} message
	 */
	processRawMessage(message) {
		// note: internally tmi.js does string splitting...but only on \r\n.
		// we need this to work for any linebreak
		for (const line of message.split('\n')) {
			this.chatClient._onMessage({data: line.trim()});
		}
	}

	/**
	 * Try to remain in a certain set of channels by sending heartbeats
	 * @param {*} channels
	 */
	heartbeat(channels) {
		const chatClient = this.chatClient;

		// If we're not in any of these channels, join them.
		channels.forEach(channel => {
			if (chatClient.channels.indexOf(`#${channel}`) < 0) {
				chatClient.join(channel).catch(error => {
					log.error(`Error attempting to join "${channel}" from heartbeat.\n\t`, error);
				});
			}
		});

		channels.forEach(channel => this.resetHeartbeat(channel));
	}

	/**
	 * Siphons must send a heartbeat every HEARTBEAT_TIMEOUT seconds.
	 * Otherwise, their channels are parted.
	 * A siphon can miss no more than one consecutive heartbeat.
	 * @param {string} channel - The channel to reset the heartbeat for.
	 * @returns {undefined}
	 */
	resetHeartbeat(channel) {
		const heartbeatTimeouts = this.heartbeatTimeouts;

		clearTimeout(heartbeatTimeouts[channel]);
		heartbeatTimeouts[channel] = setTimeout(() => {
			log.info('Heartbeat expired for', channel);
			this.chatClient.part(channel).then(() => {
				clearTimeout(heartbeatTimeouts[channel]);
				delete heartbeatTimeouts[channel];
			});
		}, (this.HEARTBEAT_TIMEOUT * 2) + 1000);
	}

	/**
	 * Formats subscription and resub events before emitting them
	 */
	_handleSubscription(data) {
		data.months = parseInt(data.months, 10);
		data.channel = data.channel.replace('#', '');
		data.resub = data.months > 1;
		data.ts = Date.now();
		this.io.to(`channel:${data.channel}`).emit('subscription', data);
	}

	connect() {
		this.chatClient.connect();
	}
}

module.exports = TwitchChatClient;
