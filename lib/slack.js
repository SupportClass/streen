'use strict';

const request = require('request-promise');
const MemoryDataStore = require('@slack/client').MemoryDataStore;
const RtmClient = require('@slack/client').RtmClient;
const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM;

const log = require('./log');
const config = require('./config');
const USE_DATABASE = config.get('persistent');

let statusChannel;
let db;

const twitchClientId = config.get('twitch').clientId;
const offlineChecks = new Map();
const FENCE = '```';
const token = config.get('slack').botToken;
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

	statusChannel = slack.dataStore.getChannelByName(self.statusChannelName);

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
			log.error('[slack] Bot has not yet been invited to #%s, will be unable to send post status updates.',
				self.statusChannelName);
			self.inStatusChannel = false;
		}
	}

	if (USE_DATABASE) {
		const listify = require('listify');
		const pgp = require('pg-promise')();
		console.log('postgres config:', config.get('postgres'));
		db = pgp(config.get('postgres'));
		// Resume checking for any notifyoffline channels that are in the database.
		db.any('SELECT channel FROM offline_checks WHERE checking=$1', [true]).then(data => {
			const channels = data.map(datum => datum.channel);
			const promises = channels.map(channel => {
				return notifyOffline(channel, {restore: true}).then(restored => {
					console.log('resolved promise for %s with %s', channel, restored);
					return {channel, restored};
				});
			});

			Promise.all(promises).then(results => {
				const restoredChannels = results.filter(result => result.restored).map(result => `\`${result.channel}\``);
				if (restoredChannels.length === 1) {
					slack.sendMessage(`I've restored the check for when ${restoredChannels[0]} goes offline.`, statusChannel.id);
				} else if (restoredChannels.length > 0) {
					slack.sendMessage(`I've restored checks for when ${listify(restoredChannels)} go offline.`, statusChannel.id);
				}
			}).catch(error => {
				console.error('Went bad!:', error);
			});
		}).catch(error => {
			log.error('Failed to initialize offline checks:\n\t', error);
		});
	}
});

slack.on(RTM_EVENTS.MESSAGE, message => {
	if (message.type !== 'message' || !message.text) {
		return;
	}

	if (!statusChannel) {
		statusChannel = slack.dataStore.getChannelByName(self.statusChannelName);
	}

	// Ignore chat from channels that aren't the status channel.
	const slackChannel = slack.dataStore.getChannelGroupOrDMById(message.channel);
	if (slackChannel.name !== self.statusChannelName) {
		return;
	}

	const trimmedMessage = message.text.trim();
	const isCmd = trimmedMessage.charAt(0) === '!';
	if (!isCmd) {
		return;
	}

	const msgTokens = trimmedMessage.split(' ');
	const cmd = msgTokens[0].substr(1);
	const cmdArguments = msgTokens.slice(1);

	switch (cmd) {
		case 'channels': {
			listChannels(message);
			break;
		}

		case 'online': {
			listOnlineStatuses(message);
			break;
		}

		case 'notifyoffline': {
			const channel = cmdArguments[0];
			notifyOffline(channel, message);
			break;
		}

		default:
		/* no action */
	}
});

slack.on(RTM_CLIENT_EVENTS.WS_ERROR, err => {
	log.error(`[slack] ${err}`);
	self.status(`I encountered an unhandled Slack error:\n${FENCE}\n${err}\n${FENCE}`);
});

slack.on(RTM_CLIENT_EVENTS.DISCONNECT, err => {
	log.error(`[slack] ${err}`);
	self.status(`I encountered an unhandled Slack error:\n${FENCE}\n${err}\n${FENCE}`);
});

slack.on(RTM_CLIENT_EVENTS.UNABLE_TO_RTM_START, err => {
	log.error(`[slack] ${err}`);
	self.status(`I encountered an unhandled Slack error:\n${FENCE}\n${err}\n${FENCE}`);
});

slack.start();

function listChannels() {
	if (chatClient.channels.length <= 0) {
		slack.sendMessage('I am not currently in any Twitch chat channels.', statusChannel.id);
		return;
	}

	const formattedChannels = chatClient.channels
		.slice(0) // Clone before sorting
		.sort()   // Sort is an in-place operation, very dangerous!
		.map(c => c.replace('#', ''))
		.join('\n');

	slack.sendMessage(`I am listening to the following Twitch chat channels:\n>>>${formattedChannels}`, statusChannel.id);
}

function listOnlineStatuses() {
	if (self._checkingOnline) {
		slack.sendMessage('Hang on a sec, still fetching online status.', statusChannel.id);
		return;
	}

	if (chatClient.channels.length <= 0) {
		slack.sendMessage('I am not currently in any Twitch chat channels.', statusChannel.id);
		return;
	}

	slack.sendMessage('Checking the online status of all streams that I am listening to' +
		', this may take a moment.', statusChannel.id);
	self._checkingOnline = true;

	const sortedChannels = chatClient.channels.slice(0).sort();
	const requestPromises = sortedChannels.map(channel => {
		channel = channel.replace('#', '');
		return {
			channel,
			isOnline: isOnline(channel)
		};
	});

	Promise.all(requestPromises).then(results => {
		self._checkingOnline = false;
		let msg = '>>>\n';
		results.forEach(result => {
			const channel = result.channel;
			const isOnline = result.isOnline;
			msg += `${channel}: ${(isOnline ? '*LIVE*' : '_Offline_')}\n`;
		});
		slack.sendMessage(msg, statusChannel.id);
	}).catch(error => {
		self._checkingOnline = false;
		const msg = 'There was an error checking one or more of the channels, ' +
			'please check the server logs and try again later.';
		log.error('[slack] Error checking online status of channels:\n', error.stack);
		slack.sendMessage(msg, statusChannel.id);
	});
}

async function notifyOffline(channel, {restore = false} = {}) {
	try {
		if (!channel) {
			slack.sendMessage('Please specify a channel when using `!notifyoffline`.', statusChannel.id);
			return false;
		}

		if (offlineChecks.has(channel)) {
			slack.sendMessage(`I am already checking to see when \`${channel}\` goes offline.`, statusChannel.id);
			return false;
		}

		let online = await isOnline(channel);
		if (!online) {
			clearInterval(offlineChecks.get(channel));
			offlineChecks.delete(channel);

			if (restore) {
				slack.sendMessage(`\`${channel}\` has gone offline.`, statusChannel.id);
			} else {
				slack.sendMessage(`\`${channel}\` is already offline.`, statusChannel.id);
			}

			if (USE_DATABASE) {
				// Tell the database that we're done checking.
				informDatabaseOfFinishedOfflineCheck(channel);
			}

			return false;
		}

		if (USE_DATABASE) {
			// Tell the database that we're checking to see when this channel goes offline.
			await db.none('INSERT INTO offline_checks(channel, checking) VALUES($1, $2) ' +
				'ON CONFLICT (channel) DO UPDATE SET checking = excluded.checking', [channel, true]);
		}

		if (!restore) {
			slack.sendMessage(`I will notify you as soon as \`${channel}\` goes offline.`, statusChannel.id);
		}

		// The only reason this is in a setTimeout is so that the formatting of the
		// restoration message can be cleaner, lol.
		setTimeout(async () => {
			try {
				while (online) {
					// Wait for 15 seconds between checks.
					await wait(15000);
					online = await isOnline(channel);
				}

				clearInterval(offlineChecks.get(channel));
				offlineChecks.delete(channel);
				slack.sendMessage(`${channel} has gone offline.`, statusChannel.id);

				if (USE_DATABASE) {
					// Tell the database that we're done checking.
					informDatabaseOfFinishedOfflineCheck(channel);
				}
			} catch (error) {
				const msg = `There was an error checking the online status of ${channel}:` +
					`\n${FENCE}\n${error}\n${FENCE}`;
				log.error('[slack] Error starting notifyoffline check:\n', error);
				slack.sendMessage(msg, statusChannel.id);
			}
		});

		return true;
	} catch (error) {
		const msg = `There was an error checking the online status of ${channel}:` +
			`\n${FENCE}\n${error}\n${FENCE}`;
		log.error('[slack] Error starting notifyoffline check:\n', error);
		slack.sendMessage(msg, statusChannel.id);
	}
}

function informDatabaseOfFinishedOfflineCheck(channel) {
	// Tell the database that we're done checking.
	db.none('UPDATE offline_checks SET checking=$1 WHERE channel=$2', [false, channel]).catch(error => {
		const msg = 'I encountered this error when attempting to tell the database that I was done checking ' +
			`to see when ${channel} goes offline:\n${FENCE}\n${error}\n${FENCE}`;
		log.error('[slack] Error executing informDatabaseOfFinishedOfflineCheck:\n', error);
		slack.sendMessage(msg, statusChannel.id);
	});
}

function wait(ms) {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve();
		}, ms);
	});
}

function isOnline(channel) {
	return request({
		uri: `https://api.twitch.tv/kraken/streams/${channel}`,
		headers: {
			'Client-ID': twitchClientId
		},
		json: true
	}).then(response => {
		return Boolean(response.stream);
	});
}
