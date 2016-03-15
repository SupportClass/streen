'use strict';

const request = require('request');
const Q = require('q');
const log = require('./log');
const config = require('hi-config');

// If the "slack" property is not present in the config, just return function stubs and do nothing.
if (!config.get('slack')) {
	log.info('No "slack" property found in config.json, will not post status to Slack');
	module.exports = {
		status() {
		}
	};
	return;
}

const Slack = require('slack-client');
const token = config.get('slack').botToken;
const slack = new Slack(token, true, true);
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

			this._statusChannel.send(text);
		} else {
			this._statusQueue.push(text);
		}
	}
};

module.exports = self;

// Wait until we've defined module.exports before loading the Twitch chat lib
const chatClient = require('./twitch_chat');

slack.on('open', () => {
	for (const channel in slack.channels) {
		if (!slack.channels.hasOwnProperty(channel)) {
			continue;
		}

		const c = slack.channels[channel];
		if (c.name !== self.statusChannelName) {
			continue;
		}

		if (c.is_member) {
			self._statusChannel = c;
			self.inStatusChannel = true;
			self.connected = true;
			self.flushStatusQueue();
		} else {
			log.error('[slack] Bot has not yet been invited to #%s, will be unable to send post status updates.'
				, self.statusChannelName);
			self.inStatusChannel = false;
		}
	}
});

slack.on('message', message => {
	if (message.type !== 'message' || !message.text) {
		return;
	}

	const channel = slack.getChannelGroupOrDMByID(message.channel);

	const trimmedMessage = message.text.trim();
	const isCmd = trimmedMessage.charAt(0) === '!';
	if (!isCmd) {
		return;
	}

	const cmd = trimmedMessage.substr(1);

	switch (cmd) {
		case 'channels': {
			if (chatClient.channels.length <= 0) {
				channel.send('I am not currently in any Twitch chat channels.');
				break;
			}

			const formattedChannels = chatClient.channels
				.slice(0) // Clone before sorting
				.sort()   // Sort is an in-place operation, very dangerous!
				.map(c => c.replace('#', ''))
				.join('\n');

			channel.send(`I am listening to the following Twitch chat channels:\n>>>${formattedChannels}`);
			break;
		}

		case 'online': {
			if (self._checkingOnline) {
				channel.send('Hang on a sec, still fetching online status.');
				break;
			}

			if (chatClient.channels.length <= 0) {
				channel.send('I am not currently in any Twitch chat channels.');
				break;
			}

			channel.send('Checking the online status of all streams that I am listening to' +
				', this may take a moment.');
			self._checkingOnline = true;

			const requestPromises = [];
			const sortedChannels = chatClient.channels.slice(0).sort();
			sortedChannels.forEach(channel => {
				channel = channel.replace('#', '');
				const deferred = Q.defer();
				request(`https://api.twitch.tv/kraken/streams/${channel}`, (error, response, body) => {
					if (error) {
						log.error('[slack] Error checking online status of channel "%s", response code %s',
							channel, response.statusCode);
						deferred.reject();
						return;
					} else if (response.statusCode !== 200) {
						log.error('[slack] Error checking online status of channel "%s":\n', channel, error);
						deferred.reject();
						return;
					}

					deferred.resolve({
						channel,
						isOnline: Boolean(JSON.parse(body).stream)
					});
				});

				requestPromises.push(deferred.promise);
			});

			Q.all(requestPromises)
				.then(results => {
					let msg = '>>>\n';
					results.forEach(result => {
						const channel = result.channel;
						const isOnline = result.isOnline;
						msg += `${channel}: ${(isOnline ? '*LIVE*' : '_Offline_')}\n`;
					});
					channel.send(msg);
					self._checkingOnline = false;
				})
				.catch(error => {
					const msg = 'There was an error checking one or more of the channels, ' +
						'please check the server logs and try again later.';
					channel.send(msg);
					self._checkingOnline = false;
					log.error('[slack] Error checking online status of channels:\n', error.stack);
				});

			break;
		}

		default:
		/* no action */
	}
});

slack.on('error', err => {
	const backticks = "```";
	log.error(`[slack] ${err}`);
	self.status(`I encountered an unhandled Slack error:\n${backticks}\n${err}\n${backticks}`);
});

slack.login();
