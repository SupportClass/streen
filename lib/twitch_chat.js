'use strict';

var log        = require('./log');
var config     = require('hi-config');
var server     = require('../server');
var pubSock    = server.pubSock;
var chat       = require('tmi.js');
var USERNAME   = config.get('username');
var chatClient = new chat.client({
    connection: {
        reconnect: true
    },
    identity: {
        username: USERNAME,
        password: config.get('password')
    }
});

module.exports = chatClient;

// Wait until we've defined module.exports before loading the Slack lib
var slack = require('./slack');

// Connect to Twitch Chat and listen for various events.
// Don't start the IPC server until we are connected to Twitch CHat.
chatClient.connect();
chatClient
    .on('connected', function () {
        log.info('Connected to Twitch Chat');
        slack.status('I\'ve connected to Twitch Chat. So many voices…');
    })

    .on('disconnected', function (reason) {
        log.warn('DISCONNECTED:', reason);
        slack.status('I\'ve disconnected from Twitch Chat. I will attempt to reconnect for as long as it takes.');
        pubSock.send('disconnected');
    })

    .on('reconnect', function () {
        log.info('Attempting to reconnect...');
        slack.status('Attempting to reconnect…');
        pubSock.send('reconnect');

        // As of Oct 3, 2015, tmi.js does not automatically rejoin channels after a reconnect.
        // The below block forces tmi.js to rejoin all the desired channels after it connects.
        chatClient.once('connected', function() {
            for (var channel in server.heartbeatTimeouts) {
                if (!server.heartbeatTimeouts.hasOwnProperty(channel)) continue;
                chatClient.join('#' + channel);
            }
            log.info('Rejoined %n channels.', Object.keys(server.heartbeatTimeouts).length);
        });
    })

    .on('join', function(channel, username) {
        if (username === USERNAME) {
            var channelNoPound = channel.replace('#', '');
            log.info('Joined channel:', channelNoPound);
        }
    })

    .on('part', function(channel, username) {
        if (username === USERNAME) {
            var channelNoPound = channel.replace('#', '');
            log.info('Parted channel:', channelNoPound);
        }
    })

    .on('chat', function (channel, user, message) {
        var channelNoPound = channel.replace('#', '');
        pubSock.send('chat', channelNoPound, user, message);
    })

    .on('subscription', onSubscription)

    .on('subanniversary', onSubscription)

    .on('timeout', function (channel, username) {
        var channelNoPound = channel.replace('#', '');
        pubSock.send('timeout', channelNoPound, username);
    })

    .on('clearchat', function (channel) {
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
