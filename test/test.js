import test from 'ava';

const config = require('../lib/config');
const {io, HEARTBEAT_TIMEOUT, setupServer } = require('../lib/server.js');
const TwitchChatClient = require('../lib/twitch_chat');

const CHANNELS = ['ghentbot'];
let globalSocket;
let tmiClient;

test.before.cb(t => {
	const client = new TwitchChatClient(io, HEARTBEAT_TIMEOUT, () => {});
	tmiClient = client.chatClient;

	// Currently in travis, it does not have a config and thus the twitch chat client never connects.
	// So these tests have to work even if there is no actual config.
	// This absolutely needs a refactor but its legacy so here it stays.
	// Mock a "connected" tmi client that always succeeds joining
	Object.defineProperty(client, 'connected', {
		get: () => true
	});

	tmiClient.join = function () {
		return Promise.resolve();
	};

	setupServer(client);

	globalSocket = require('socket.io-client')(`http://localhost:${config.get('port')}`);

	globalSocket.on('connect', () => {
		console.log('Done with setup, commencing tests.');
		t.end();
	});
});

test.cb('reject invalid authentication key', t => {
	t.plan(1);

	const socket = require('socket.io-client')(`http://localhost:${config.get('port')}`);
	socket.emit('authenticate', 'invalid_key', errorMsg => {
		t.is(errorMsg, 'invalid key');
		t.end();
	});
});

test.cb('disallow commands before authentication', t => {
	t.plan(1);

	const socket = require('socket.io-client')(`http://localhost:${config.get('port')}`);
	socket.emit('join', 'test', () => {
		t.fail();
	});

	setTimeout(() => {
		t.pass();
		t.end();
	}, 100);
});

test.serial.cb('accept valid authentication key', t => {
	t.plan(1);

	const key = config.get('secretKey');
	globalSocket.emit('authenticate', key, errorMsg => {
		if (errorMsg) {
			return t.fail(errorMsg);
		}

		t.pass();
		t.end();
	});
});

test.serial.cb('disallow multiple authentication from a single socket', t => {
	t.plan(1);

	const key = config.get('secretKey');
	globalSocket.emit('authenticate', key, errorMsg => {
		t.is(errorMsg, 'already authenticated');
		t.end();
	});
});

test.serial.cb('join channels', t => {
	t.plan(1);

	CHANNELS.forEach(channel => {
		console.log('asking to join:', channel);
		globalSocket.emit('join', channel, (err, alreadyJoined) => {
			console.log('join callback for:', channel);

			if (err) {
				return t.fail(err);
			}

			if (alreadyJoined) {
				t.fail(`Streen already in channel: ${alreadyJoined}`);
			} else {
				t.pass();
				t.end();
			}
		});
	});
});

test.serial.cb('subscription events', t => {
	t.plan(2);

	globalSocket.once('subscription', data => {
		t.is(typeof data.ts, 'number');
		t.deepEqual(data, {
			channel: 'ghentbot',
			username: 'sub_test',
			resub: false,
			method: {prime: false},
			months: 1,
			ts: data.ts
		});
		t.end();
	});

	tmiClient.emit('subscription', 'ghentbot', 'sub_test', {prime: false});
});

test.serial.cb('resubscription events', t => {
	t.plan(2);

	globalSocket.once('subscription', data => {
		t.is(typeof data.ts, 'number');
		t.deepEqual(data, {
			channel: 'ghentbot',
			username: 'resub_test',
			resub: true,
			months: 5,
			message: 'test message',
			ts: data.ts
		});
		t.end();
	});

	tmiClient.emit('resub', 'ghentbot', 'resub_test', 5, 'test message');
});

test.serial.cb('room isolation', t => {
	t.plan(0);

	globalSocket.once('subscription', () => {
		t.fail();
	});

	setTimeout(() => {
		t.end();
	}, 100);

	tmiClient.emit('subscription', 'channel_this_socket_isnt_in', 'sub_test', {prime: false});
});
