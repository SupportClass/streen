'use strict';

var log       = require('./lib/log');
var config    = require('hi-config'); config.load('config.json');
var format    = require('util').format;
var slack     = require('./lib/slack');
var irc       = require('twitch-irc');
var rpc       = require('axon-rpc');
var axon      = require('axon');
var rep       = axon.socket('rep');
var pubSock   = axon.socket('pub');
var rpcServer = new rpc.Server(rep);

var socketsBound      = false;
var heartbeatTimeouts = {};
var PUB_PORT          = config.get('pubPort') || 9455;
var RPC_PORT          = config.get('rpcPort') || 9456;
var HEARTBEAT_TIMEOUT = 15 * 1000;
var ircClient         = new irc.client({
    options: {
        exitOnError: false,
        database: './data'
    },
    identity: {
        username: config.get('username'),
        password: config.get('password')
    }
});

//var db     = require('twitch-irc-db')({database: './data'});
//var api    = require('twitch-irc-api');

// twitch-irc can be leaky. This enables a sysadmin to pass '--expose-gc' and force a full GC cycle every 15 minutes.
if (global.gc) {
    log.info('Running manual garbage collection every 15 minutes');
    setInterval(function () {
        global.gc();
    }, 15 * 60 * 1000);
}

// Oh no
process.on('unhandledException', function (err) {
    log.error(err.stack);
    slack.send(format('I\'ve encountered an unhandled error, and will now exit:```%s```', err.stack));
    pubSock.send('crash', err);
    process.exit(1);
});

process.on('SIGINT', function () {
    log.info('Exiting from SIGINT in one second');
    slack.send('I\'m exiting from a deliberate SIGINT. This was probably intentional.');
    setTimeout(function () {
        process.exit(0);
    }, 1000);
});

// Monkey-patch the broken fastReconnect method.
// This patch has a drawback of not being zero-downtime, but it's dang close.
ircClient.fastReconnect = function () {
    this.disconnect();
    this.connect();
}.bind(ircClient);

// Connect to Twitch Chat and listen for various events.
// Don't start the IPC server until we are connected to Twitch CHat.
ircClient.connect();
ircClient
    .addListener('connected', function () {
        log.info('Connected to Twitch Chat');
        slack.send('I\'ve connected to Twitch Chat. So many voices…');
        if (socketsBound) {
            pubSock.send('connected');
        } else {
            bindSockets();
        }
    })

    .addListener('disconnected', function (reason) {
        log.warn('DISCONNECTED:', reason);
        slack.send('I\'ve disconnected from Twitch Chat. I will attempt to reconnect for as long as it takes.');
        pubSock.send('disconnected');
    })

    .addListener('reconnect', function () {
        log.info('Attempting to reconnect...');
        slack.send('Attempting to reconnect…');
        pubSock.send('reconnect');
    })

    .addListener('connectfail', function () {
        log.error('Failed to connect, reached maximum number of retries');
        slack.send('I\'ve failed to connect to Twitch Chat after reaching the max number of retries!');
        pubSock.send('connectfail');
    })

    .addListener('limitation', function (err) {
        log.error('Limitation:', err);
        slack.send('I\'ve encountered a rate limitation! Check my logs.');
        pubSock.send('limitation', err);
    })

    .addListener('crash', function (message, stack) {
        log.error(stack);
        slack.send(format('I\'ve encountered an unhandled error, and will now exit:```%s```', stack));
        pubSock.send('crash', {message: message, stack: stack});
        process.exit(1);
    })

    .addListener('join', function (channel, username) {
        var channelNoPound = channel.replace('#', '');
        log.info('Joined channel:', channelNoPound);
        pubSock.send('join', channelNoPound, username);
    })

    .addListener('part', function (channel, username) {
        var channelNoPound = channel.replace('#', '');
        log.info('Parted channel:', channelNoPound);
        pubSock.send('part', channelNoPound, username);
    })

    .addListener('chat', function (channel, user, message) {
        var channelNoPound = channel.replace('#', '');
        pubSock.send('chat', channelNoPound, user, message);
    })

    .addListener('subscription', onSubscription)

    .addListener('subanniversary', onSubscription)

    .addListener('timeout', function (channel, username) {
        var channelNoPound = channel.replace('#', '');
        pubSock.send('timeout', channelNoPound, username);
    })

    .addListener('clearchat', function (channel) {
        var channelNoPound = channel.replace('#', '');
        pubSock.send('clearchat', channelNoPound);
    });

function bindSockets() {
    pubSock.bind(PUB_PORT);
    rep.bind(RPC_PORT);
    pubSock.send('connected');

    socketsBound = true;

    // Streen does not join any channels on its own.
    // It waits for a Siphon to request that it join an array of channels.
    rpcServer.expose('join', function (channel, fn) {
        if (ircClient.currentChannels.indexOf(channel) >= 0) {
            // Already in channel, invoke callback with the name
            fn(null, channel);
        } else {
            ircClient.join('#' + channel).then(function () {
                resetHeartbeat(channel);
            });
            fn(null, null);
        }
    });

    rpcServer.expose('timeout', function (channel, username, seconds, fn) {
        ircClient.timeout(channel, username, seconds).then(function() {
            fn(channel, username, seconds);
        });
    });

    rpcServer.expose('heartbeat', function (channels, fn) {
        channels.forEach(resetHeartbeat);
        fn(null, HEARTBEAT_TIMEOUT);
    });
}

// Siphons must send a heartbeat every HEARTBEAT_TIMEOUT seconds.
// Otherwise, their channels are parted.
// A siphon can miss no more than one consecutive heartbeat.
function resetHeartbeat(channel, fn) {
    fn = fn || function () {};
    clearTimeout(heartbeatTimeouts[channel]);
    heartbeatTimeouts[channel] = setTimeout(function () {
        ircClient.part('#' + channel).then(function () {
            clearTimeout(heartbeatTimeouts[channel]);
            delete heartbeatTimeouts[channel];
            fn(null, channel);
        });
    }, HEARTBEAT_TIMEOUT * 2 + 1000);
}

// Formats subscription and subanniversary events before emitting them
function onSubscription(channel, username, months) {
    var channelNoPound = channel.replace('#', '');
    pubSock.send('subscription', {
        channel: channelNoPound,
        username: username,
        resub: !!months,
        months: months,
        ts: Date.now()
    });
}
