import test from 'ava';
import TwitchChatClient from '../lib/twitch_chat';
import socketio from 'socket.io';
import http from 'http';
import fs from 'fs';

// Example raw data came from log tracking twitch streamers

let httpServer;
let socketServer;

let tmiClient;
let globalSocket;

test.before(() => {
	httpServer = http.createServer().listen();
	socketServer = socketio(httpServer);

	// Create a fake join event where the socket joins the channel.
	// this allows the socket to receive messages broadcast to a channel
	socketServer.on('connection', socket => {
		socket.on('join', (channel, fn) => {
			socket.join(`channel:${channel}`);
			fn();
		});
	});
});

test.beforeEach.cb(t => {
	const httpServerAddress = httpServer.address();

	tmiClient = new TwitchChatClient(socketServer, 15 * 1000, () => {});
	const address = `http://[${httpServerAddress.address}]:${httpServerAddress.port}`;
	globalSocket = require('socket.io-client')(address);

	globalSocket.on('connect', () => {
		console.log('Socket connected for test');
		t.end();
	});
});

// Close servers once all tests have completed
test.after(() => {
	socketServer.close();
	httpServer.close();
});

test.afterEach(() => {
	globalSocket.close();
});

test.serial.cb('detects prime sub', t => {
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

test.serial.cb('detect twitch prime resub', t => {
	const data = '@badge-info=subscriber/22;badges=subscriber/12,premium/1;color=#FFFFFF;display-name=TorbenYT;emotes=;flags=;id=788fea21-df2b-43eb-91ce-ee9a3e88e3ec;login=torbenyt;mod=0;msg-id=resub;msg-param-cumulative-months=22;msg-param-months=0;msg-param-should-share-streak=1;msg-param-streak-months=22;msg-param-sub-plan-name=Channel\sSubscription\s(asmongold);msg-param-sub-plan=Prime;room-id=26261471;subscriber=1;system-msg=TorbenYT\ssubscribed\swith\sTwitch\sPrime.\sThey\'ve\ssubscribed\sfor\s22\smonths,\scurrently\son\sa\s22\smonth\sstreak!;tmi-sent-ts=1566240995050;user-id=93002681;user-type= :tmi.twitch.tv USERNOTICE #asmongold :hi asmon';

	globalSocket.once('subscription', data => {
		t.is(typeof data.ts, 'number');
		t.deepEqual(data, {
			...data,
			channel: 'asmongold',
			resub: true,
			method: {
				...data.method,
				plan: 'Prime',
				prime: true
			}
		});
		t.end();
	});

	globalSocket.emit('join', 'asmongold', () => {
		tmiClient.processRawMessage(data);
	});
});

test.serial.cb('handle sub mystery gifts', t => {
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

test.serial.cb('handle sub gift', t => {
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
});

test.serial.cb('handles raids', t => {
	const raw = '@badge-info=subscriber/46;badges=moderator/1,subscriber/42,partner/1;color=#187FA5;display-name=gsmVoiD;emotes=;flags=;id=9e440621-183a-43a3-ab0d-fdf6c0f22643;login=gsmvoid;mod=1;msg-id=raid;msg-param-displayName=gsmVoiD;msg-param-login=gsmvoid;msg-param-profileImageURL=https://static-cdn.jtvnw.net/jtv_user_pictures/f4cdcadb-9481-41bd-854a-e58aa8489e78-profile_image-70x70.jpeg;msg-param-viewerCount=169;room-id=75502413;subscriber=1;system-msg=169\sraiders\sfrom\sgsmVoiD\shave\sjoined!;tmi-sent-ts=1566261523344;user-id=81764480;user-type=mod :tmi.twitch.tv USERNOTICE #nairomk';
	globalSocket.on('hosted', data => {
		t.deepEqual(data, {
			...data,
			channel: 'nairomk',
			raid: true,
			autohost: false
		});
		t.end();
	});

	globalSocket.emit('join', 'nairomk', () => {
		tmiClient.processRawMessage(raw);
	});
});
