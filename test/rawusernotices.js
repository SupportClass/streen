import test from 'ava';
import TwitchChatClient from '../lib/twitch_chat';
import socketio from 'socket.io';
import http from 'http';
import fs from 'fs';

let tmiClient;
let globalSocket;

const httpServer = http.createServer().listen();
const httpServerAddress = httpServer.address();
const socketServer = socketio(httpServer);

// Example raw data came from log tracking top twitch streamers

// Create a fake join event where the socket joins the channel.
// this allows the socket to receive messages broadcast to a channel
socketServer.on('connection', socket => {
	socket.on('join', (channel, fn) => {
		socket.join(`channel:${channel}`);
		fn();
	});
});

test.cb.beforeEach(t => {
	tmiClient = new TwitchChatClient(socketServer, 15 * 1000);
	const address = `http://[${httpServerAddress.address}]:${httpServerAddress.port}`;
	globalSocket = require('socket.io-client')(address);

	globalSocket.on('connect', () => {
		t.end();
	});
});

test.cb.serial('detects prime sub', t => {
	// sample from https://gist.github.com/AlcaDesign/8cdeb8c556b5d30ba142d72630009513
	const raw = '@badge-info=subscriber/0;badges=subscriber/0,premium/1;color=#1E90FF;display-name=Fresbor;emotes=;flags=;id=89842774-f1d4-4335-b740-def5a1450f7e;login=fresbor;mod=0;msg-id=sub;msg-param-cumulative-months=1;msg-param-months=0;msg-param-should-share-streak=0;msg-param-sub-plan-name=Piano\\sFeels;msg-param-sub-plan=Prime;room-id=67955580;subscriber=1;system-msg=Fresbor\\ssubscribed\\swith\\sTwitch\\sPrime.;tmi-sent-ts=1565990122006;user-id=64948822;user-type= :tmi.twitch.tv USERNOTICE #chewiemelodies';

	globalSocket.once('subscription', data => {
		t.is(typeof data.ts, 'number');
		t.deepEqual(data, {
			...data,
			channel: 'chewiemelodies',
			resub: false,
			method: {
				...data.method,
				plan: 'Prime',
				prime: true
			},
			months: 1
		});
		t.end();
	});

	globalSocket.emit('join', 'chewiemelodies', () => {
		tmiClient.processRawMessage(raw);
	});
});

// test.cb.serial('detect twitch prime resub', t => {
// 	// sample from https://gist.github.com/AlcaDesign/8cdeb8c556b5d30ba142d72630009513
// 	const data = '@badge-info=subscriber/2;badges=subscriber/0,bits/100;color=#0000FF;display-name=aseptil;emotes=;flags=;id=e997bc87-a148-4589-b338-ff0a0f7f79c7;login=aseptil;mod=0;msg-id=resub;msg-param-cumulative-months=2;msg-param-months=0;msg-param-should-share-streak=1;msg-param-streak-months=1;msg-param-sub-plan-name=Channel\\sSubscription\\s(kamet0);msg-param-sub-plan=Prime;room-id=27115917;subscriber=1;system-msg=aseptil\\ssubscribed\\swith\\sTwitch\\sPrime.\\sThey\'ve\\ssubscribed\\sfor\\s2\\smonths,\\scurrently\\son\\sa\\s1\\smonth\\sstreak!;tmi-sent-ts=1565990464330;user-id=86581639;user-type= :tmi.twitch.tv USERNOTICE #kamet0 :plop';

// 	globalSocket.once('subscription', data => {
// 		t.is(typeof data.ts, 'number');
// 		t.deepEqual(data, {
// 			...data,
// 			channel: 'kamet0',
// 			resub: true,
// 			method: {
// 				...data.method,
// 				plan: 'Prime',
// 				prime: true
// 			}
// 		});
// 		t.end();
// 	});

// 	globalSocket.emit('join', 'kamet0', () => {
// 		tmiClient.processRawMessage(data);
// 	});
// });

test.cb.serial('handle sub mystery gifts', t => {
	let subgiftMessage = null;
	let subgiftCount = 0;

	globalSocket.on('submysterygift', data => {
		subgiftMessage = data;
	});

	globalSocket.on('subgift', () => {
		subgiftCount++;
	});

	globalSocket.on('submysterygiftcomplete', data => {
		t.is(subgiftCount, 0, 'subgift events should have been ignored');
		t.is(data.recipients.length, data.amount);
		t.truthy(subgiftMessage, 'expecting submysterygift event to fire');
		t.end();
	});

	fs.readFile('test/submysterygift.txt', 'utf8', (err, data) => {
		if (err) {
			throw err;
		}

		globalSocket.emit('join', 'tfue', () => {
			tmiClient.processRawMessage(data);
		});
	});
});

test.cb.serial('handle sub gift', t => {
	const raw = '@badge-info=;badges=twitchconNA2019/1;color=#CEFF00;display-name=FriendZone_95;emotes=;flags=;id=724cbc6b-c438-4c32-ab05-393c5c99a0b4;login=friendzone_95;mod=0;msg-id=subgift;msg-param-months=1;msg-param-origin-id=da\s39\sa3\see\s5e\s6b\s4b\s0d\s32\s55\sbf\sef\s95\s60\s18\s90\saf\sd8\s07\s09;msg-param-recipient-display-name=Toxic_Peralta;msg-param-recipient-id=81278879;msg-param-recipient-user-name=toxic_peralta;msg-param-sender-count=0;msg-param-sub-plan-name=Channel\sSubscription\s(Tfue);msg-param-sub-plan=1000;room-id=60056333;subscriber=0;system-msg=FriendZone_95\sgifted\sa\sTier\s1\ssub\sto\sToxic_Peralta!;tmi-sent-ts=1566168828011;user-id=144009485;user-type= :tmi.twitch.tv USERNOTICE #tfue';
	globalSocket.on('subgift', data => {
		t.deepEqual(data, {
			...data,
			channel: 'tfue',
			username: 'FriendZone_95',
			recipient: 'Toxic_Peralta'
		});
		t.end();
	});

	globalSocket.emit('join', 'tfue', () => {
		tmiClient.processRawMessage(raw);
	});
})
