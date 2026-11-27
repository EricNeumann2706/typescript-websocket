import test from 'node:test';
import assert from 'node:assert/strict';
import { WeeklyResultHandler, weeklyDiscordMessage, isWeeklyResult } from '../src/handlers/weekly-result-handler.ts';

class MemoryStorage {
	values = new Map();
	tail = Promise.resolve();
	async get(key) { return structuredClone(this.values.get(key)); }
	async put(key, value) { this.values.set(key, structuredClone(value)); }
	async delete(key) { return this.values.delete(key); }
	transaction(callback) {
		const result = this.tail.then(() => callback(this));
		this.tail = result.catch(() => {});
		return result;
	}
}

const webhook = 'https://discord.com/api/webhooks/123/test-token';
const result = () => ({
	runId: '123456781234123412341234567890ab', weeklyIdentifier: 'weekly_2026-11-27_12',
	steamId: '76561198000000001', username: 'Esel', score: 1842, rounds: 60,
	leader: 'Genghis Khan', modifiers: ['No material buildings'], gameVersion: '1.56',
	newPersonalBest: true, personalRank: 2,
	currentLeader: { steamId: '76561198000000002', username: 'Jonathan', score: 2105 },
});
const request = (body = result()) => new Request('https://game.test/weekly-result', { method: 'POST', body: JSON.stringify(body) });

test('posts completion, personal best and current leader with mentions disabled', async () => {
	let sent;
	const handler = new WeeklyResultHandler(new MemoryStorage(), webhook, async (url, options) => {
		assert.equal(new URL(url).searchParams.get('wait'), 'true');
		sent = JSON.parse(options.body);
		return Response.json({ id: 'message-1' });
	});
	assert.equal((await handler.handle(request())).status, 201);
	assert.deepEqual(sent.allowed_mentions, { parse: [] });
	assert.match(sent.embeds[0].description, /1842 Glory/);
	assert.match(sent.embeds[0].description, /New personal best/);
	assert.match(sent.embeds[0].fields.find(f => f.name === 'Leader after upload').value, /2105 Glory/);
});

test('lower-scoring completion is posted without claiming a new best', () => {
	const payload = weeklyDiscordMessage({ ...result(), score: 100, newPersonalBest: false });
	assert.match(payload.embeds[0].description, /100 Glory/);
	assert.doesNotMatch(payload.embeds[0].description, /New personal best/);
});

test('sequential retries and a recreated handler do not post twice', async () => {
	const storage = new MemoryStorage(); let posts = 0;
	const send = async () => { posts++; return Response.json({ id: 'message-1' }); };
	await new WeeklyResultHandler(storage, webhook, send).handle(request());
	const retry = await new WeeklyResultHandler(storage, webhook, send).handle(request());
	assert.equal((await retry.json()).status, 'duplicate');
	assert.equal(posts, 1);
});

test('concurrent same-run reports share the durable reservation', async () => {
	let release; const gate = new Promise(resolve => { release = resolve; }); let posts = 0;
	const handler = new WeeklyResultHandler(new MemoryStorage(), webhook, async () => {
		posts++; await gate; return Response.json({ id: 'message-1' });
	});
	const first = handler.handle(request());
	await new Promise(resolve => setTimeout(resolve, 0));
	const second = await handler.handle(request());
	assert.equal((await second.json()).status, 'pending');
	release(); await first;
	assert.equal(posts, 1);
});

test('an explicit Discord rate limit is safe to retry', async () => {
	let posts = 0;
	const handler = new WeeklyResultHandler(new MemoryStorage(), webhook, async () => ++posts === 1
		? Response.json({ retry_after: 3 }, { status: 429 }) : Response.json({ id: 'message-1' }));
	const limited = await handler.handle(request());
	assert.equal(limited.status, 429);
	assert.equal((await limited.json()).retryAfter, 3);
	assert.equal((await handler.handle(request())).status, 201);
});

test('unknown delivery outcome never blindly posts the same run again', async () => {
	let posts = 0;
	const handler = new WeeklyResultHandler(new MemoryStorage(), webhook, async () => { posts++; throw new Error('network'); });
	assert.equal((await (await handler.handle(request())).json()).status, 'uncertain');
	assert.equal((await (await handler.handle(request())).json()).status, 'uncertain');
	assert.equal(posts, 1);
});

test('abandoned in-flight reservation stops polling after restart without duplicate', async () => {
	const storage = new MemoryStorage();
	await storage.put(`weekly-result:${result().steamId}:${result().runId}`, { status: 'sending', startedAt: Date.now() - 61000 });
	const handler = new WeeklyResultHandler(storage, webhook, async () => { throw new Error('must not post'); });
	assert.equal((await (await handler.handle(request())).json()).status, 'uncertain');
});

test('missing secret, invalid reports and oversized payloads never call Discord', async () => {
	const send = async () => { throw new Error('must not post'); };
	assert.equal((await new WeeklyResultHandler(new MemoryStorage(), undefined, send).handle(request())).status, 503);
	const handler = new WeeklyResultHandler(new MemoryStorage(), webhook, send);
	assert.equal((await handler.handle(request({ ...result(), score: '1842' }))).status, 400);
	assert.equal((await handler.handle(new Request('https://game.test/weekly-result'))).status, 405);
	assert.equal((await handler.handle(request({ ...result(), username: 'x'.repeat(17000) }))).status, 413);
	assert.equal(isWeeklyResult({ ...result(), currentLeader: { score: 1 } }), false);
});

test('user formatting is escaped and modifier fields stay within Discord limits', () => {
	const payload = weeklyDiscordMessage({ ...result(), username: '@everyone **test**', modifiers: ['*'.repeat(2000), 'x'.repeat(2000), 'y'.repeat(2000)] });
	assert.deepEqual(payload.allowed_mentions.parse, []);
	assert.match(payload.embeds[0].description, /\\\*\\\*test/);
	assert.ok(payload.embeds[0].fields.find(f => f.name === 'Modifiers').value.length <= 1024);
});
