#Streen
Streen is a centralized interface for interacting with Twitch Chat. It is essentially a wrapper for 
[twitch-irc](https://github.com/twitch-irc/twitch-irc), and it operates via IPC.

Streen is useful in situations where multiple processes all need to connect to Twitch Chat, 
but the overhead of spinning up multiple IRC bots is not acceptable. Streen operates as a single bot and exposes
an evented IPC interface via [axon](https://github.com/tj/axon).

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
- Run with `node index.js`

## Example
See [lfg-siphon](https://github.com/SupportClass/lfg-siphon) for an example implementation.

### License
Streen is provided under the MIT license, which is available to read in the [LICENSE][] file.
[license]: LICENSE
