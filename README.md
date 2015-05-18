#Streen
Streen is a centralized interface for interacting with Twitch Chat. It operates via IPC.

Streen is useful in situations where multiple processes all need to connect to Twitch Chat, 
but the overhead of spinning up multiple IRC bots is not acceptable. Streen operates as a single bot and exposes
an evented IPC interface via [node-ipc](https://github.com/RIAEvangelist/node-ipc).

## Installation
- Clone the repository
- From the directory you cloned Streen into, run `npm install --production`
- Create `./config.json` with the desired Twitch `username` and `password`. Optionally, add a 
[`slack.webhook`](https://my.slack.com/services/new/incoming-webhook/) URL and `slack.channel` 
to have Streen post critical status updates.
```json
{
  "username": "botname",
  "password": "oauth:myOauthToken1234",
  "slack": {
      "webhook": "https://hooks.slack.com/services/xxx/yyy/zzz",
      "channel": "#somechannel"
    }
}
```

## API
```javascript
var os            = require('os');
var ipc           = require('node-ipc');
var CHANNELS      = ['teamfortresstv'];
ipc.config.id     = 'siphon'; // You can change this to whatever you like.
ipc.config.retry  = 1500;
ipc.config.silent = true;     // node-ipc has built-in logging that, while comprehensive, is very spammy.

// Uses TCP sockets on Windows, Unix sockets on Linux/Mac
var connectFn = os.platform() === 'win32' ? ipc.connectToNet : ipc.connectTo;
connectFn('streen', function () {
    // Connect to Streen, then request to join an array of channels.
    ipc.of.streen.on('connect', function () {
        console.log('Connected to Streen');
        ipc.of.streen.emit('join', CHANNELS);
    });

    ipc.of.streen.on('disconnect', function () {
        console.log('Disconnected from Streen');
    });

    // This will only fire for channels that this code has asked to join.
    ipc.of.streen.on('joined', function (channel) {
        console.log('Joined channel:', channel);
    });

    // Listen for subscription and subAnniversary events.
    // If this is a new subscription, "data.months" will be undefined.
    ipc.of.streen.on('subscription', function (data) {
        console.log('Subscription:', data.channel, data.username, data.months);
    });

    ipc.of.streen.on('chat', function (data) {
        console.log('Chat:', data.channel, data.user, data.message);
    });
});
```

### License
Streen is provided under the MIT license, which is available to read in the [LICENSE][] file.
[license]: LICENSE
