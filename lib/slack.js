'use strict';

var log    = require('./log');
var config = require('hi-config');

if (!config.get('slack')) {
    log.info('No "slack" property found in config.json, will not post status to Slack');
    module.exports.send = function(){};
} else {
    var slackBot = require('slack-bot')(config.get('slack').webhook);
    module.exports.send = function(msg, cb) {
        if (typeof cb !== 'function') cb = function(){};
        slackBot.send({
            text: msg,
            channel: config.get('slack').channel,
            username: 'Streen',
            icon_url: 'http://i.imgur.com/eXgv57K.jpg'
        }, cb);
    };
}
