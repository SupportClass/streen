const TABLE_NAME = 'offline_checks';

exports.up = function (pgm) {
	const columns = {
		channel: {
			type: 'varchar(32)', // Max Twitch channel name length is 25, but add extra space just in case.
			unique: true,
			primaryKey: true,
			notNull: true
		},
		checking: {
			type: 'boolean',
			notNull: true
		}
	};

	pgm.createTable(TABLE_NAME, columns);
};

exports.down = function (pgm) {
	pgm.dropTable(TABLE_NAME);
};
