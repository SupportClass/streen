#Streen [![Build Status](https://travis-ci.org/SupportClass/streen.svg?branch=master)](https://travis-ci.org/SupportClass/streen) [![Coverage Status](https://coveralls.io/repos/github/SupportClass/streen/badge.svg?branch=master)](https://coveralls.io/github/SupportClass/streen?branch=master)
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)  

Streen is a centralized interface for interacting with Twitch Chat. It is essentially a wrapper for 
[tmi.js](https://docs.tmijs.org/), and it operates via Socket.IO websockets.

Streen is useful in situations where multiple processes all need to connect to Twitch Chat, 
but the overhead of spinning up multiple and managing multiple chat bots is not acceptable. 
Streen operates as a single bot and exposes a websocket API.

## Installation
- [Deploying to Heroku (recommended)](#deploying-to-heroku)
- [Manual installation](#manual-installation)

### Deploying to Heroku
- Click the "Deploy to Heroku" button at the top of this README.
- Fill out the form. Be sure to provide all required config variables.
- If using a free dyno (the default), you'll need to prevent it from sleeping. 
This can be done by periodically pinging the dyno. [Apex Ping](https://ping.apex.sh/) and 
[Pingdom](https://www.pingdom.com/) are two options for this, but there are many ways to prevent a free web dyno from 
sleeping.

### Manual Installation
- Clone the repository
- From the directory you cloned Streen into, run `npm install --production`
- Create `./config.json` with the desired `twitch.username`, `twitch.password`, and `secretKey`. 
The `secretKey` is a pre-shared key that all clients must provide in order to use the websocket API.
- Optionally, add a [`slack.botToken`](https://my.slack.com/services/new/bot) and `slack.statusChannel` 
to have Streen post critical status updates and respond to commands. 
[(Need an avatar for your bot?)](http://i.imgur.com/7LNvGeK.jpg)
```json
{
  "twitch": {
    "username": "botname",
    "password": "oauth:myOauthToken1234",
    "clientId": "abcdefghijk"
  },
  "slack": {
    "botToken": "xoxb-xxxxxxxxxx-yyyyyyyyyy",
    "statusChannel": "#somechannel"
  },
  "port": 8232,
  "logLevel": "info",
  "secretKey": "xxxxx"
}
```
- Run with `node server.js`

## Example
See [lfg-siphon](https://github.com/SupportClass/lfg-siphon) for an example implementation.

## Slack Commands
### !channels
Lists the current Twitch chat channels that Streen is listening to.  
![channels command example](https://i.imgur.com/072ECjo.png)

### !online
Lists the online status of each Twitch stream that Streen is listening to.  
![online command example](https://i.imgur.com/TMiOISh.png)

### !notifyoffline <channel>
Notifies you when `channel` stops streaming. Useful for planning maintenance or remembering
to speak to someone when they go offline for the day.

### License
Streen is provided under the MIT license, which is available to read in the [LICENSE][] file.
[license]: LICENSE
