const fs = require('fs');
const convict = require('convict');
const parsePgConnectString = require('pg-connection-string').parse;

// pg-promise seems to choke on the DATABASE_URL that Heroku genreates,
// so we parse it ourselves into a format that we know works.
const pgConnect = parsePgConnectString(process.env.DATABASE_URL || '');
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
	},
	persistent: {
		doc: 'Whether or not to persist state (such as what channels to check via !notifyoffline) across restarts. Requires a valid postgres.',
		format: Boolean,
		default: false,
		env: 'PERSISTENT',
		arg: 'persistent'
	},
	postgres: {
		host: {
			doc: 'The host or IP address of the Postgres server to connect to.',
			format: String,
			default: pgConnect.host || 'localhost',
			env: 'POSTGRES_HOST',
			arg: 'postgresHost'
		},
		port: {
			doc: 'The port on which to attempt to connecto to Postgres.',
			format: 'port',
			default: parseInt(pgConnect.port, 10) || 5432,
			env: 'POSTGRES_PORT',
			arg: 'postgresPort'
		},
		database: {
			doc: 'The name of the database to connect to in Postgres.',
			format: String,
			default: pgConnect.database || (process.platform === 'win32' ? process.env.USERNAME : process.env.USER),
			env: 'POSTGRES_DATABASE',
			arg: 'postgresDatabase'
		},
		user: {
			doc: 'The username to authenticate as in Postgres.',
			format: String,
			default: pgConnect.user || (process.platform === 'win32' ? process.env.USERNAME : process.env.USER),
			env: 'POSTGRES_USER',
			arg: 'postgresUser'
		},
		password: {
			doc: 'The password to use for authentication to Postgres.',
			format: String,
			default: pgConnect.password,
			env: 'POSTGRES_PASSWORD',
			arg: 'postgresPassword'
		},
		ssl: {
			doc: 'Whether or not to use SSL when connecting to Postgres. Required for Heroku Postgres.',
			format: Boolean,
			default: true,
			env: 'POSTGRES_SSL',
			arg: 'postgreslSsl'
		},
		application_name: {
			doc: 'The name displayed in the pg_stat_activity view and included in CSV log entries.',
			format: String,
			default: 'Streen',
			env: 'POSTGRES_APPLICATION_NAME',
			arg: 'postgresApplicationName'
		},
		fallback_application_name: {
			doc: 'Fallback value for the application_name configuration parameter.',
			format: String,
			default: undefined,
			env: 'POSTGRES_FALLBACK_APPLICATION_NAME',
			arg: 'postgresFallbackApplicationName'
		},
		poolSize: {
			doc: 'The number of connections to use in the Postgres connection pool. 0 will disable pooling.',
			format: 'nat',
			default: 10,
			env: 'POSTGRES_POOL_SIZE',
			arg: 'postgresPoolSize'
		}
	}
});

if (fs.existsSync('./config.json')) {
	conf.loadFile('./config.json');
}

// Perform validation
conf.validate({allowed: 'strict'});

module.exports = conf;
