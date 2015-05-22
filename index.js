'use strict';

var config = require('hi-config'); config.load('config.json');
var os     = require('os');
var format = require('util').format;
var ipc    = require('node-ipc');
var slack  = require('./lib/slack');
var irc    = require('twitch-irc');
//var db     = require('twitch-irc-db')({database: './data'});
//var api    = require('twitch-irc-api');

ipc.config.id        = 'streen';
ipc.config.retry     = 1500;
ipc.config.silent    = true;
var siphonsByChannel = {};
var client           = new irc.client({
    options: {
        exitOnError: false,
        database: './data'
    },
    identity: {
        username: config.get('username'),
        password: config.get('password')
    }
});

// twitch-irc can be leaky. This enables a sysadmin to pass '--expose-gc' and force a full GC cycle every 15 minutes.
if (global.gc) {
    console.log('Running manual garbage collection every 15 minutes');
    setInterval(function() {
        global.gc();
    }, 15 * 60 * 1000);
}

// Oh no
process.on('unhandledException', function(err) {
    console.error(err.stack);
    slack.send(format('I\'ve encountered an unhandled error, and will now exit:```%s```', err.stack));
    ipc.server.broadcast('crash', err);
    process.exit(1);
});

process.on('SIGINT', function () {
    console.log('Exiting from SIGINT in one second'.notice);
    slack.send('I\'m exiting from a deliberate SIGINT. This was probably intentional.');
    setTimeout(function() {
        process.exit(0);
    }, 1000);
});

// Monkey-patch the broken fastReconnect method.
// This patch has a drawback of not being zero-downtime, but it's dang close.
client.fastReconnect = function() {
    this.disconnect();
    this.connect();
}.bind(client);

// Connect to Twitch Chat and listen for various events.
// Don't start the IPC server until we are connected to Twitch CHat.
client.connect();
client
    .addListener('connected', function () {
        console.log('Connected to Twitch Chat'.good);
        slack.send('I\'ve connected to Twitch Chat. So many voices…');
        if (ipc.server) ipc.server.broadcast('connected');
        startIPCServer();
    })

    .addListener('disconnected', function (reason) {
        console.warn('DISCONNECTED:'.warn, reason);
        slack.send('I\'ve disconnected from Twitch Chat. I will attempt to reconnect for as long as it takes.');
        ipc.server.broadcast('disconnected');
    })

    .addListener('reconnect', function () {
        console.log('Attempting to reconnect...'.notice);
        slack.send('Attempting to reconnect…');
        ipc.server.broadcast('reconnect');
    })

    .addListener('connectfail', function () {
        console.error('Failed to connect, reached maximum number of retries'.error);
        slack.send('I\'ve failed to connect to Twitch Chat after reaching the max number of retries!');
        ipc.server.broadcast('connectfail');
    })

    .addListener('limitation', function (err) {
        console.error('Limitation:'.error, err);
        slack.send('I\'ve encountered a rate limitation! Check my logs.');
        ipc.server.broadcast('limitation', err);
    })

    .addListener('crash', function (message, stack) {
        console.error(stack);
        slack.send(format('I\'ve encountered an unhandled error, and will now exit:```%s```', stack));
        ipc.server.broadcast('crash', {message: message, stack: stack});
        process.exit(1);
    })

    .addListener('subscription', onSubscription)

    .addListener('subanniversary', onSubscription)

    .addListener('chat', function (channel, user, message) {
        var channelNoPound = channel.replace('#', '');
        multicastToChannel(channelNoPound, 'chat', {
            channel: channelNoPound,
            user: user,
            message: message
        });
    });


function startIPCServer() {
    var serveFn = os.platform() === 'win32' ? ipc.serveNet : ipc.serve;
    serveFn(function () {
        /*ipc.server.on('apiCall', function (data, socket) {
         api.call(data.opts, db, function(err, statusCode, response) {
         if (err) {
         console.log(err);
         return;
         }
         console.log('Status code: ' + statusCode);
         console.log('Response from Twitch API:');
         console.log(JSON.stringify(response));
         socket.emit('apiResponse', response);
         });
         });*/

        ipc.server.broadcast('connected');

        // Streen does not join any channels on its own.
        // It waits for a Siphon to request that it join an array of channels.
        ipc.server.on('join', function (channels, socket) {
            channels.forEach(function(channel) {
                client.join('#' + channel).then(function() {
                    console.log('Joined channel'.debug, channel.data);
                    if (!siphonsByChannel.hasOwnProperty(channel)) siphonsByChannel[channel] = new WeakSet();
                    siphonsByChannel[channel].add(socket);
                    ipc.server.emit(socket, 'joined', channel);
                });
            });
        });

        // When a Siphon (socket) closes, remove it from any channel sets that it is in.
        ipc.server.on('socket.disconnected', function(socket, destroyedSocketId) {
            for (var channel in siphonsByChannel) {
                if (!siphonsByChannel.hasOwnProperty(channel)) continue;
                siphonsByChannel[channel].delete(socket);

                // If there are no more sockets listening to this channel, then part
                var hasActiveSocket = false;
                ipc.server.sockets.forEach(function(socket) {
                    if (siphonsByChannel[channel].has(socket)) {
                        hasActiveSocket = true;
                    }
                });
                if (!hasActiveSocket) {
                    console.log('Parted channel'.debug, channel.data);
                    client.part('#' + channel);
                    delete siphonsByChannel[channel];
                }
            }
        });
    });

    ipc.server.start();
}

// Multicasts an event only to sockets that are interested in a given channel
function multicastToChannel(channel, event, data) {
    if (!siphonsByChannel.hasOwnProperty(channel)) return;
    ipc.server.sockets.forEach(function(socket) {
        if (siphonsByChannel[channel].has(socket)) {
            ipc.server.emit(socket, event, data);
        }
    });
}

// Formats subscription and subanniversary events before emitting them
function onSubscription(channel, username, months) {
    var channelNoPound = channel.replace('#', '');
    multicastToChannel(channelNoPound, 'subscription', {
        channel: channelNoPound,
        username: username,
        resub: !!months,
        months: months,
        ts: Date.now()
    });
}
