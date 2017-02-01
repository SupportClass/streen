<a name="0.4.0"></a>
# [0.4.0](https://github.com/SupportClass/streen/compare/v0.3.2...v0.4.0) (2017-02-01)


* use new @slack/client lib. send client-id header with twitch API requests ([d076d3e](https://github.com/SupportClass/streen/commit/d076d3e))


### Bug Fixes

* resub events ([487ae74](https://github.com/SupportClass/streen/commit/487ae74))
* **package:** update convict to version 2.0.0 ([#4](https://github.com/SupportClass/streen/issues/4)) ([4c2af37](https://github.com/SupportClass/streen/commit/4c2af37))


### Code Refactoring

* use WebSockets (via Socket.IO) instead of RPC ([885d44e](https://github.com/SupportClass/streen/commit/885d44e))


### Features

* **chat:** update tmi.js to 0.0.29, support aws cluster by default ([33894b6](https://github.com/SupportClass/streen/commit/33894b6))
* **twitchchat:** update tmi.js to 0.0.28 ([6703eec](https://github.com/SupportClass/streen/commit/6703eec))
* emit resub message w/ subscription event ([92fb3c4](https://github.com/SupportClass/streen/commit/92fb3c4))


### Styles

* **all:** adopt xo/esnext style ([756f081](https://github.com/SupportClass/streen/commit/756f081))


### BREAKING CHANGES

* All clients must now connect via Socket.IO
* config format has changed. `username` and `password` now go in a `twitch` object. This object also needs a `clientId` string.
* Streen no longer responds to commands from channels that aren't the configured status channel
* Ported to ES6, require Node.js >= 4.0.0



<a name="0.3.2"></a>
## [0.3.2](https://github.com/SupportClass/streen/compare/v0.3.1...v0.3.2) (2015-10-03)



<a name="0.3.1"></a>
## [0.3.1](https://github.com/SupportClass/streen/compare/v0.3.0...v0.3.1) (2015-10-03)



<a name="0.3.0"></a>
# 0.3.0 (2015-09-29)



