'use strict';

var request   = require('request');
var Q         = require('q');
var log       = require('./log');
var config    = require('hi-config');

// If the "slack" property is not present in the config, just return function stubs and do nothing.
if (!config.get('slack')) {
    log.info('No "slack" property found in config.json, will not post status to Slack');
    return {
        send: function(){}
    }
}

var Slack = require('slack-client');
var token = config.get('slack').botToken;
var slack = new Slack(token, true, true);
var self  = {
    statusChannelName: config.get('slack').statusChannel,
    inStatusChannel: false,
    connected: false,

    _statusQueue: [],
    _statusChannel: null,

    flushStatusQueue: function() {
        self._statusQueue.forEach(function (text) {
            self.status(text);
        });
        self._statusQueue = [];
    },
    status: function(text) {
        if (!self.connected) {
            self._statusQueue.push(text);
        } else {
            if (!self.inStatusChannel) return;
            self._statusChannel.send(text);
        }
    }
};

module.exports = self;

// Wait until we've defined module.exports before loading the Twitch IRC lib
var ircClient = require('./twitch_irc');

slack.on('open', function () {
    for (var channel in slack.channels) {
        if (!slack.channels.hasOwnProperty(channel)) continue;

        var c = slack.channels[channel];
        if (c.name !== self.statusChannelName) continue;

        if (!c.is_member) {
            log.error('[slack] Bot has not yet been invited to #%s, will be unable to send post status updates.'
                , self.statusChannelName);
            self.inStatusChannel = false;
        } else {
            self._statusChannel = c;
            self.inStatusChannel = true;
            self.connected = true;
            self.flushStatusQueue();
        }
    }
});

slack.on('message', function(message) {
    if (message.type !== 'message') return;

    var channel = slack.getChannelGroupOrDMByID(message.channel);
    if (channel.name !== self.statusChannelName) return;

    var trimmedMessage = message.text.trim();
    var isCmd = trimmedMessage.charAt(0) === '!';
    if (!isCmd) return;

    var cmd = trimmedMessage.substr(1);

    switch (cmd) {
        case 'channels':
            var formattedChannels = ircClient.currentChannels
                .slice(0) // Clone before sorting
                .sort()   // Sort is an in-place operation, very dangerous!
                .join('\n');

            channel.send('I am listening to the following Twitch chat channels:\n>>>' +  formattedChannels);
            break;
        case 'online':
            if (self._checkingOnline) {
                channel.send('Hang on a sec, still fetching online status.');
                return;
            }

            channel.send('Checking the online status of all streams that I am listening to'
                + ', this may take a moment.');
            self._checkingOnline = true;

            var requestPromises = [];
            var sortedChannels = ircClient.currentChannels.slice(0).sort();
            sortedChannels.forEach(function(channel) {
                var deferred = Q.defer();
                request('https://api.twitch.tv/kraken/streams/' + channel, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        deferred.resolve({
                            channel: channel,
                            isOnline: !!JSON.parse(body).stream
                        });
                    } else {
                        log.error('[slack] Error checking online status of channel "%s":\n', channel, body);
                        deferred.reject();
                    }
                });
                requestPromises.push(deferred.promise);
            });

            Q.allSettled(requestPromises)
                .then(function(results) {
                    var msg = '>>>\n';
                    results.forEach(function(result) {
                        var channel = result.value.channel;
                        var isOnline = result.value.isOnline;
                        msg += channel + ': ' + (isOnline ? '*LIVE*' : '_Offline_') + '\n';
                    });
                    channel.send(msg);
                    self._checkingOnline = false;
                });

            break;
    }
});

slack.on('error', function(err) {
    log.error(err);
    self.status('I encountered an unhandled Slack error:\n```\n'+err+'\n```');
});

slack.login();
