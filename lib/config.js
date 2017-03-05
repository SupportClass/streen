const fs = require('fs');
const convict = require('convict');
const conf = convict({
	twitch: {
		username: {
			doc: 'The Twitch username of the account to connect to chat as.',
			format: String,
			default: '',
			env: 'TWITCH_USERNAME',
			arg: 'twitchUsername'
		},
		password: {
			doc: 'The password of the Twitch account to connect to chat as.',
			format: String,
			default: '',
			env: 'TWITCH_PASSWORD',
			arg: 'twitchPassword'
		},
		clientId: {
			doc: 'A Twitch API ClientID, used for making some API calls.',
			format: String,
			default: '',
			env: 'TWITCH_CLIENT_ID',
			arg: 'twitchClientId'
		}
	},
	slack: {
		botToken: {
			doc: '(Optional) The token of a Slack bot, used to post status messages.',
			format: String,
			default: '',
			env: 'SLACK_BOT_TOKEN',
			arg: 'slackBotToken'
		},
		statusChannel: {
			doc: '(Optional) The Slack channel in which to post status updates.',
			format: String,
			default: '',
			env: 'SLACK_STATUS_CHANNEL',
			arg: 'slackStatusChannel'
		}
	},
	port: {
		doc: 'The port on which to listen.',
		format: 'port',
		default: 80,
		env: 'PORT',
		arg: 'port'
	},
	logLevel: {
		doc: 'The level at which to log info',
		format: ['trace', 'debug', 'info', 'warn', 'error'],
		default: 'info',
		env: 'LOG_LEVEL',
		arg: 'logLevel'
	},
	secretKey: {
		doc: 'The secret key that client sockets must provide when connecting.',
		format: String,
		default: '',
		env: 'SECRET_KEY',
		arg: 'secretKey'
	}
});

if (fs.existsSync('./config.json')) {
	conf.loadFile('./config.json');
}

// Perform validation
conf.validate({strict: true});

module.exports = conf;
