'use strict';

const BACKTICKS = '```';
const request = require('request-promise');
const Promise = require('bluebird');
const log = require('./log');
const config = require('./config');

// If the "slack" property is not present in the config, just return function stubs and do nothing.
if (config.get('slack.botToken')) {
	const MemoryDataStore = require('@slack/client').MemoryDataStore;
	const RtmClient = require('@slack/client').RtmClient;
	const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
	const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM;
	const token = config.get('slack').botToken;
	const twitchClientId = config.get('twitch').clientId;
	const slack = new RtmClient(token, {
		logLevel: 'error',
		dataStore: new MemoryDataStore()
	});
	const self = {
		statusChannelName: config.get('slack').statusChannel,
		inStatusChannel: false,
		connected: false,

		_statusQueue: [],
		_statusChannel: null,

		flushStatusQueue() {
			this._statusQueue.forEach(text => self.status(text));
			this._statusQueue = [];
		},

		status(text) {
			if (this.connected) {
				if (!this.inStatusChannel) {
					return;
				}

				slack.sendMessage(text, this._statusChannel.id);
			} else {
				this._statusQueue.push(text);
			}
		}
	};

	module.exports = self;

// Wait until we've defined module.exports before loading the Twitch chat lib
	const chatClient = require('./twitch_chat');

	slack.on(RTM_CLIENT_EVENTS.CONNECTING, () => {
		log.info('[slack] Connecting...');
	});

	slack.on(RTM_CLIENT_EVENTS.AUTHENTICATED, () => {
		log.info('[slack] Authenticated.');
	});

	slack.on(RTM_CLIENT_EVENTS.WS_OPENING, () => {
		log.info('[slack] Opening websocket...');
	});

	slack.on(RTM_CLIENT_EVENTS.WS_OPENED, () => {
		log.info('[slack] Websocket opened.');
	});

	slack.on(RTM_CLIENT_EVENTS.ATTEMPTING_RECONNECT, () => {
		log.info('[slack] Attempting reconnect...');
	});

	slack.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, () => {
		log.info('[slack] RTM connection opened.');

		for (const channel in slack.dataStore.channels) {
			if (!{}.hasOwnProperty.call(slack.dataStore.channels, channel)) {
				continue;
			}

			const c = slack.dataStore.channels[channel];
			if (c.name !== self.statusChannelName) {
				continue;
			}

			if (c.is_member) {
				self._statusChannel = c;
				self.inStatusChannel = true;
				self.connected = true;

				// On a delay until this bug is fixed: https://github.com/slackhq/node-slack-sdk/issues/253
				setTimeout(() => {
					self.flushStatusQueue();
				}, 1500);
			} else {
				log.error('[slack] Bot has not yet been invited to #%s, will be unable to send post status updates.'
					, self.statusChannelName);
				self.inStatusChannel = false;
			}
		}
	});

	slack.on(RTM_EVENTS.MESSAGE, message => {
		if (message.type !== 'message' || !message.text) {
			return;
		}

		// Ignore chat from channels that aren't the status channel.
		const channel = slack.dataStore.getChannelGroupOrDMById(message.channel);
		if (channel.name !== self.statusChannelName) {
			return;
		}

		const trimmedMessage = message.text.trim();
		const isCmd = trimmedMessage.charAt(0) === '!';
		if (!isCmd) {
			return;
		}

		const cmd = trimmedMessage.substr(1);

		switch (cmd) {
			case 'channels': {
				if (chatClient.channels.length <= 0) {
					slack.sendMessage('I am not currently in any Twitch chat channels.', channel.id);
					break;
				}

				const formattedChannels = chatClient.channels
					.slice(0) // Clone before sorting
					.sort()   // Sort is an in-place operation, very dangerous!
					.map(c => c.replace('#', ''))
					.join('\n');

				slack.sendMessage(`I am listening to the following Twitch chat channels:\n>>>${formattedChannels}`, channel.id);
				break;
			}

			case 'online': {
				if (self._checkingOnline) {
					slack.sendMessage('Hang on a sec, still fetching online status.', channel.id);
					break;
				}

				if (chatClient.channels.length <= 0) {
					slack.sendMessage('I am not currently in any Twitch chat channels.', channel.id);
					break;
				}

				slack.sendMessage('Checking the online status of all streams that I am listening to' +
					', this may take a moment.', channel.id);
				self._checkingOnline = true;

				const sortedChannels = chatClient.channels.slice(0).sort();
				const requestPromises = sortedChannels.map(channel => {
					channel = channel.replace('#', '');
					return request({
						uri: `https://api.twitch.tv/kraken/streams/${channel}`,
						headers: {
							'Client-ID': twitchClientId
						},
						json: true
					}).then(response => {
						return {
							channel,
							isOnline: Boolean(response.stream)
						};
					});
				});

				Promise.all(requestPromises)
					.then(results => {
						let msg = '>>>\n';
						results.forEach(result => {
							const channel = result.channel;
							const isOnline = result.isOnline;
							msg += `${channel}: ${(isOnline ? '*LIVE*' : '_Offline_')}\n`;
						});
						slack.sendMessage(msg, channel.id);
						self._checkingOnline = false;
					})
					.catch(error => {
						const msg = 'There was an error checking one or more of the channels, ' +
							'please check the server logs and try again later.';
						slack.sendMessage(msg, channel.id);
						self._checkingOnline = false;
						log.error('[slack] Error checking online status of channels:\n', error.stack);
					});

				break;
			}

			default:
			/* no action */
		}
	});

	slack.on(RTM_CLIENT_EVENTS.WS_ERROR, err => {
		log.error(`[slack] ${err}`);
		self.status(`I encountered an unhandled Slack error:\n${BACKTICKS}\n${err}\n${BACKTICKS}`);
	});

	slack.on(RTM_CLIENT_EVENTS.DISCONNECT, err => {
		log.error(`[slack] ${err}`);
		self.status(`I encountered an unhandled Slack error:\n${BACKTICKS}\n${err}\n${BACKTICKS}`);
	});

	slack.on(RTM_CLIENT_EVENTS.UNABLE_TO_RTM_START, err => {
		log.error(`[slack] ${err}`);
		self.status(`I encountered an unhandled Slack error:\n${BACKTICKS}\n${err}\n${BACKTICKS}`);
	});

	slack.start();
} else {
	log.info('No "slack" property found in config.json, will not post status to Slack');
	module.exports = {
		status() {}
	};
}
