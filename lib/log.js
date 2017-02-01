'use strict';

const winston = require('winston');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logDir = path.resolve(__dirname, '../logs');
const LEVEL = config.get('logLevel') || 'info';

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
			filename: `${logDir}/streen.log`,
			level: LEVEL
		}),
		new (winston.transports.Console)({
			prettyPrint: true,
			colorize: true,
			level: LEVEL
		})
	],
	levels: {
		trace: 4,
		debug: 3,
		info: 2,
		warn: 1,
		error: 0
	}
});
