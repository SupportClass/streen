'use strict';

var winston = require('winston');
var fs      = require('fs');
var path    = require('path');
var config  = require('hi-config');
var logDir  = path.resolve(__dirname, '../logs');
var LEVEL   = config.get('logLevel') || 'info';

// Make log directory if it does not exist
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

winston.addColors({
    trace: 'green',
    debug: 'cyan',
    info: 'white',
    warn: 'yellow',
    error: 'red'
});

module.exports = new (winston.Logger)({
    transports: [
        new (winston.transports.File)({
            json: false,
            prettyPrint: true,
            filename: logDir + '/streen.log',
            level: LEVEL
        }),
        new (winston.transports.Console)({
            prettyPrint: true,
            colorize: true,
            level: LEVEL
        })
    ],
    levels: {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4
    }
});
