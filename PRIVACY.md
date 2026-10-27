# Privacy Policy: Oyez Oyez Oyez

_Last updated: 2026-10-27_

Oyez Oyez Oyez is a Reddit Developer Platform (Devvit) app that posts new U.S. Supreme Court opinions and orders to the subreddit where it is installed.

## What the app collects

Nothing about people. The app does not collect, store or process personal information about Reddit users, moderators or subreddit members.

## What the app stores

In Devvit's built-in Redis storage, inside Reddit's infrastructure:

- Identifiers of Court items already posted (case numbers and PDF URLs), so nothing is posted twice
- A flag that records that setup was completed
- Timestamps used to limit log messages to one per hour

## What the app sends elsewhere

The app makes read-only HTTPS `GET` requests to `www.supremecourt.gov` to read the Court's public opinion feed, orders page and docket data. These requests contain only the page address. They contain no user, subreddit or Reddit data. The app sends no data to any other third party.

## Retention and deletion

Stored identifiers are kept while the app is installed. Uninstalling the app from a subreddit removes its stored data.

## Contact

Questions: message u/phrique on Reddit.
