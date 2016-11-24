import test from 'ava';

const CHANNELS = ['ghentbot'];
const SUB_PORT = 9455;
const RPC_PORT = 9456;

const axon = require('axon');
const rpc = require('axon-rpc');
const req = axon.socket('req');
const subSock = axon.socket('sub');
const rpcClient = new rpc.Client(req);
let tmiClient;

test.cb.before(t => {
	require('../server.js');
	subSock.connect(SUB_PORT, '127.0.0.1');
	req.connect(RPC_PORT, '127.0.0.1');

	let subSockConnected = false;
	let tmiClientConnected = false;
	subSock.on('connect', () => {
		subSockConnected = true;
		checkDone();
	});

	tmiClient = require('../lib/twitch_chat');
	if (tmiClient.readyState().toUpperCase() === 'OPEN') {
		tmiClientConnected = true;
		checkDone();
	} else {
		tmiClient.once('connected', () => {
			tmiClientConnected = true;
			checkDone();
		});
	}

	function checkDone() {
		if (subSockConnected && tmiClientConnected) {
			t.end();
		}
	}
});

test.cb('join channels', t => {
	t.plan(1);

	CHANNELS.forEach(channel => {
		console.log('asking to join:', channel);
		rpcClient.call('join', channel, (err, alreadyJoined) => {
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

	subSock.once('message', (msg, data) => {
		if (msg.toString() === 'subscription') {
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
		}
	});

	tmiClient.emit('subscription', 'ghentbot', 'sub_test', {prime: false});
});

test.serial.cb('resubscription events', t => {
	t.plan(2);

	subSock.once('message', (msg, data) => {
		if (msg.toString() === 'subscription') {
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
		}
	});

	tmiClient.emit('resub', 'ghentbot', 'resub_test', 5, 'test message');
});
