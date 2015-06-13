'use strict';

var log       = require('./log');
var config    = require('hi-config');
var format    = require('util').format;
var pubSock   = require('../server').pubSock;
var irc       = require('twitch-irc');
var ircClient = new irc.client({
    options: {
        exitOnError: false,
        database: './data'
    },
    identity: {
        username: config.get('username'),
        password: config.get('password')
    }
});

module.exports = ircClient;

// Wait until we've defined module.exports before loading the Slack lib
var slack = require('./slack');

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
        slack.status('I\'ve connected to Twitch Chat. So many voices…');
    })

    .addListener('disconnected', function (reason) {
        log.warn('DISCONNECTED:', reason);
        slack.status('I\'ve disconnected from Twitch Chat. I will attempt to reconnect for as long as it takes.');
        pubSock.send('disconnected');
    })

    .addListener('reconnect', function () {
        log.info('Attempting to reconnect...');
        slack.status('Attempting to reconnect…');
        pubSock.send('reconnect');
    })

    .addListener('connectfail', function () {
        log.error('Failed to connect, reached maximum number of retries');
        slack.status('I\'ve failed to connect to Twitch Chat after reaching the max number of retries!');
        pubSock.send('connectfail');
    })

    .addListener('limitation', function (err) {
        log.error('Limitation:', err);
        slack.status('I\'ve encountered a rate limitation! Check my logs.');
        pubSock.send('limitation', err);
    })

    .addListener('crash', function (message, stack) {
        log.error(stack);
        slack.status(format('I\'ve encountered an unhandled error, and will now exit:```%s```', stack));
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
