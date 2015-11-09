'use strict';

var log       = require('./lib/log');
var config    = require('hi-config'); config.load('config.json');
var format    = require('util').format;
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

module.exports = {
    pubSock: pubSock,
    rpcServer: rpcServer,
    heartbeatTimeouts: heartbeatTimeouts
};

// Wait until we've defined module.exports before loading the Twitch IRC and Slack libs
var chatClient = require('./lib/twitch_chat');
var slack     = require('./lib/slack');

// The old twitch-irc lib could be leaky. TMI.js might not be. Just to be careful though,
// this enables a sysadmin to pass '--expose-gc' and force a full GC cycle every 15 minutes.
if (global.gc) {
    log.info('Running manual garbage collection every 15 minutes');
    setInterval(function () {
        global.gc();
    }, 15 * 60 * 1000);
}

// Oh no
process.on('unhandledException', function (err) {
    log.error(err.stack);
    slack.status(format('I\'ve encountered an unhandled error, and will now exit:```%s```', err.stack));
    pubSock.send('crash', err);
    setTimeout(function () {
        process.exit(1);
    }, 1000);
});

process.on('SIGINT', function () {
    log.info('Exiting from SIGINT in one second');
    slack.status('I\'m exiting from a deliberate SIGINT. This was probably intentional.');
    setTimeout(function () {
        process.exit(0);
    }, 1000);
});

chatClient
    .addListener('connected', function () {
        if (socketsBound) {
            pubSock.send('connected');
        } else {
            bindSockets();
        }
    });

function bindSockets() {
    pubSock.bind(PUB_PORT);
    rep.bind(RPC_PORT);
    pubSock.send('connected');

    socketsBound = true;

    /**
     * Join a Twitch chat channel.
     * @param {String} channel - The name of the channel to join. Do not include a leading "#" character.
     * @param {Function} fn - The callback to execute after successfully joining the channel.
     */
    rpcServer.expose('join', function (channel, fn) {
        resetHeartbeat(channel);
        if (chatClient.channels.indexOf('#' + channel) >= 0) {
            // Already in channel, invoke callback with the name
            fn(null, channel);
        } else {
            chatClient.join('#' + channel).then(function() {
                fn(null, null);
            });
        }
    });

    /**
     * Send a message to a Twitch chat channel as the user specified in the config file.
     * @param {String} channel - The name of the channel to send a message to. Do not include a leading "#" character.
     * @param {String} message - The message to send.
     * @param {Function} fn - The callback to execute after successfully sending the message.
     */
    rpcServer.expose('say', function (channel, message, fn) {
        chatClient.say(channel, message).then(function() {
            fn(null, null);
        });
    });

    /**
     * Timeout a user in a Twitch chat channel for a given number of seconds.
     * @param {String} channel - The name of the channel to execute the timeout command in. Do not include a leading "#" character.
     * @param {String} username - The name of the user to timeout.
     * @param {Number} seconds - The number of seconds to time the user out for.
     * @param {Function} fn - The callback to execute after successfully timing out the user.
     */
    rpcServer.expose('timeout', function (channel, username, seconds, fn) {
        chatClient.timeout(channel, username, seconds).then(function() {
            fn(null, null);
        });
    });

    /**
     * Tell Streen that you wish for it to remain in this array of channels.
     * @param {Array.<string>} channels - The array of channel names. Do not include leading "#" characters.
     * @param {heartbeatCallback} fb - The callback to execute after the heartbeat has been registered.
     */
    rpcServer.expose('heartbeat', function (channels, fn) {
        // If we're not in any of these channels, join them.
        channels.forEach(function(channel) {
            if (chatClient.channels.indexOf('#' + channel) < 0) {
                chatClient.join('#' + channel);
            }
        });

        channels.forEach(resetHeartbeat);
        fn(null, HEARTBEAT_TIMEOUT);
    });

    /**
     * The type of callback to execute after a successful heartbeat request.
     * @callback heartbeatCallback
     * @param {Object} err - The error returned, if any.
     * @param {Number} heartbeatTimeout - How long to wait (in milliseconds) before sending the next heartbeat.
     *                                    Heartbeats can be sent earlier or later if needed.
     *                                    A siphon has up to (heartbeatTimeout * 2 + 1000) milliseconds to
     *                                    send another heartbeat before it times out. In other words, it can only miss
     *                                    one consecutive heartbeat.
     */
}

// Siphons must send a heartbeat every HEARTBEAT_TIMEOUT seconds.
// Otherwise, their channels are parted.
// A siphon can miss no more than one consecutive heartbeat.
function resetHeartbeat(channel) {
    clearTimeout(heartbeatTimeouts[channel]);
    heartbeatTimeouts[channel] = setTimeout(function () {
        log.info('Heartbeat expired for', channel);
        chatClient.part('#' + channel).then(function () {
            clearTimeout(heartbeatTimeouts[channel]);
            delete heartbeatTimeouts[channel];
        });
    }, HEARTBEAT_TIMEOUT * 2 + 1000);
}

