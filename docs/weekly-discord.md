# Weekly Challenge results in Discord

The client reports a completed run only after Steam confirms its score upload. It snapshots
the challenge ID, run score, player/Steam ID, monarch, modifiers and game version. The Steam
callback supplies the personal-best flag and best-score rank; a subsequent top-one query
adds the current leader when available. Lower-scoring runs are posted too.
The leader is a snapshot after the upload, not a claim about a possibly much later delivery time.

## Setup

1. Create an incoming webhook in the desired Discord text channel (channel settings →
   Integrations → Webhooks). Its URL is a secret; do not put it in the game or Git.
2. In this repository, install the existing dependencies and configure the Worker secret:

   ```sh
   yarn install
   yarn wrangler secret put DISCORD_WEEKLY_WEBHOOK_URL --name typescript-websocket
   ```

   Paste the webhook URL at Wrangler's prompt. No Discord bot application or bot token is needed.
3. Deploy this Worker with `yarn deploy --name typescript-websocket` before testing the updated game. The client derives
   its HTTP reporting URL from `LobbySystem.WEB_SOCKET_SERVER_URL`; use the same Worker hostname.
   The current client points to `typescript-websocket.mixed-moon-games.workers.dev`; the checked-in
   Wrangler name is different, so the explicit `--name` targets the existing client endpoint.
4. Complete a Weekly Challenge. The game logs `[Leaderboard] Score uploaded` and subsequently
   `[Weekly] Discord result delivered`. The server logs `[Weekly] Posted run ...`.

For local Wrangler development, use an ignored `.dev.vars` file containing the secret.
`POST /weekly-result` is routed to a separate instance of the existing Durable Object class
(`weekly-results`), so reporting does not serialize Discord requests with active lobbies.
No new Durable Object binding or migration is needed.

## Delivery behavior

- Only Steam-confirmed uploads enter the client's persistent `user://weekly_discord_outbox.json`.
  An application restart retries pending reports, even if it interrupted the optional leader query.
- Each play scene creates a run ID. Repeated callbacks/HTTP retries for the same Steam ID and run
  are deduplicated in durable storage, including across Worker restarts. A separately loaded and
  completed game counts as a new run. The existing Steam "keep best" upload behavior is unchanged.
- Missing webhook configuration, explicit Discord errors and rate limits are retried without
  blocking the game's endscreen. Invalid reports are rejected. Usernames cannot trigger mentions.
- Discord webhooks do not provide an atomic transaction with our storage. If Discord times out
  after possibly accepting a post, or the Worker restarts mid-send, the result is marked uncertain
  instead of sending again blindly. This avoids duplicate posts but can lose that notification.
  Check the run ID in the channel and Worker logs for those rare cases.
- Reports and leader information are client-provided, not server-verified against Steam. This
  follows the game's existing leaderboard trust model; the endpoint is not an anti-cheat system.
- The public result message is English; modifier descriptions and monarch names are shown as
  supplied by the client. Normal campaigns/tutorials do not post.

## Checks

`yarn test` runs mocked webhook delivery tests (Node 22.6+; tested with Node 24).
`yarn typecheck` checks the server; the repository currently has unrelated pre-existing
TypeScript errors. `yarn wrangler deploy --dry-run` checks the Worker bundle without publishing.
