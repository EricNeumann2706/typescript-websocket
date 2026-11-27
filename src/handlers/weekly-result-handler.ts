export interface WeeklyResult {
	runId: string;
	weeklyIdentifier: string;
	steamId: string;
	username: string;
	score: number;
	rounds: number;
	leader: string;
	modifiers: string[];
	gameVersion: string;
	newPersonalBest: boolean;
	personalRank: number;
	currentLeader?: { steamId: string; username: string; score: number };
}

type Delivery = { status: 'sending' | 'posted' | 'uncertain'; messageId?: string; startedAt?: number; phase?: string; failure?: string };
const MAX_BODY_BYTES = 16 * 1024;
const DISCORD_TIMEOUT_MS = 8000;

function isText(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function isWeeklyResult(value: any): value is WeeklyResult {
	return value != null && isText(value.runId, 64) && /^[a-f0-9-]{32,36}$/i.test(value.runId)
		&& isText(value.weeklyIdentifier, 80) && /^weekly_[a-z0-9_-]+$/i.test(value.weeklyIdentifier)
		&& typeof value.steamId === 'string' && /^\d{1,20}$/.test(value.steamId)
		&& isText(value.username, 100) && Number.isInteger(value.score) && Math.abs(value.score) <= 2147483647
		&& Number.isInteger(value.rounds) && value.rounds >= 0 && value.rounds <= 100000
		&& isText(value.leader, 100) && isText(value.gameVersion, 80)
		&& Array.isArray(value.modifiers) && value.modifiers.length <= 3 && value.modifiers.every((m: unknown) => isText(m, 2000))
		&& typeof value.newPersonalBest === 'boolean' && Number.isInteger(value.personalRank) && value.personalRank >= 0
		&& (value.currentLeader === undefined || (value.currentLeader != null
			&& typeof value.currentLeader.steamId === 'string' && /^\d{1,20}$/.test(value.currentLeader.steamId)
			&& isText(value.currentLeader.username, 100) && Number.isInteger(value.currentLeader.score)
			&& Math.abs(value.currentLeader.score) <= 2147483647));
}

function escapeText(text: string): string {
	return text.replace(/[\\`*_{}\[\]()<>~|]/g, '\\$&');
}

export function weeklyDiscordMessage(result: WeeklyResult) {
	const fields = [
		{ name: 'Challenge', value: '`' + result.weeklyIdentifier + '`', inline: true },
		{ name: 'Monarch', value: escapeText(result.leader), inline: true },
		{ name: 'Modifiers', value: result.modifiers.length ? result.modifiers.map(m => '• ' + escapeText(m).slice(0, 300)).join('\n') : 'None' },
	];
	if (result.personalRank > 0)
		fields.push({ name: 'Personal best rank', value: '#' + result.personalRank, inline: true });
	if (result.currentLeader)
		fields.push({ name: 'Leader after upload', value: `**${escapeText(result.currentLeader.username)}** — **${result.currentLeader.score} Glory**`, inline: false });
	return {
		username: 'Monarchs at Play',
		allowed_mentions: { parse: [] },
		embeds: [{
			title: 'Weekly Challenge completed',
			description: `[${escapeText(result.username)}](https://steamcommunity.com/profiles/${result.steamId}) finished with **${result.score} Glory** in **${result.rounds} turns**.`
				+ (result.newPersonalBest ? '\n🏆 **New personal best!**' : ''),
			fields,
			footer: { text: `Game version: ${result.gameVersion} · Run: ${result.runId}` },
			timestamp: new Date().toISOString(),
		}],
	};
}

function reply(status: number, data: object): Response {
	return Response.json(data, { status });
}

export class WeeklyResultHandler {
	private storage: DurableObjectStorage;
	private webhook: string | undefined;
	private send: typeof fetch;

	constructor(storage: DurableObjectStorage, webhook?: string, send: typeof fetch = fetch) {
		this.storage = storage;
		this.webhook = webhook;
		this.send = send.bind(globalThis);
	}

	async handle(request: Request): Promise<Response> {
		if (request.method !== 'POST') return reply(405, { error: 'POST required' });
		if (!this.webhook) return reply(503, { error: 'Discord reporting is not configured', retryAfter: 300 });
		if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return reply(413, { error: 'Result too large' });
		let result: WeeklyResult;
		try {
			const body = await request.text();
			if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return reply(413, { error: 'Result too large' });
			result = JSON.parse(body);
			if (!isWeeklyResult(result)) return reply(400, { error: 'Invalid weekly result' });
		} catch {
			return reply(400, { error: 'Invalid JSON' });
		}
		let url: URL;
		try {
			url = new URL(this.webhook);
			if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || !url.pathname.startsWith('/api/webhooks/'))
				return reply(503, { error: 'Discord reporting is not configured', retryAfter: 300 });
			url.searchParams.set('wait', 'true');
		} catch {
			return reply(503, { error: 'Discord reporting is not configured', retryAfter: 300 });
		}

		const key = `weekly-result:${result.steamId}:${result.runId}`;
		const previous = await this.storage.transaction(async tx => {
			const existing = await tx.get<Delivery>(key);
			if (existing?.status === 'sending' && Date.now() - (existing.startedAt ?? 0) > 60000) {
				await tx.put<Delivery>(key, { status: 'uncertain' });
				return { status: 'uncertain' } as Delivery;
			}
			if (!existing) await tx.put<Delivery>(key, { status: 'sending', startedAt: Date.now() });
			return existing;
		});
		if (previous?.status === 'posted') return reply(200, { status: 'duplicate' });
		if (previous?.status === 'uncertain') return reply(202, { status: 'uncertain', phase: previous.phase, failure: previous.failure });
		if (previous) return reply(202, { status: 'pending', retryAfter: 5 });

		let phase = 'webhook request';
		try {
			const response = await this.send(url.toString(), {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(weeklyDiscordMessage(result)), signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
			});
			if (!response.ok) {
				await this.storage.delete(key);
				console.warn(`[Weekly] Discord returned ${response.status} for run ${result.runId}.`);
				if (response.status === 429) {
					const rateLimit = await response.json() as { retry_after?: number };
					return reply(429, { error: 'Discord rate limit', retryAfter: Math.max(1, Number(rateLimit.retry_after) || 5) });
				}
				return reply(503, { error: 'Discord unavailable', retryAfter: 60 });
			}
			phase = 'Discord response';
			const message = await response.json() as { id: string };
			phase = 'delivery confirmation storage';
			await this.storage.put<Delivery>(key, { status: 'posted', messageId: message.id });
			console.log(`[Weekly] Posted run ${result.runId} to Discord.`);
			return reply(201, { status: 'posted' });
		} catch (error) {
			// A timed-out webhook may already have posted. Never blindly send it a second time.
			// Do not log exception messages: fetch errors can contain the secret webhook URL.
			const failure = error instanceof Error ? error.name : 'UnknownError';
			await this.storage.put<Delivery>(key, { status: 'uncertain', phase, failure });
			console.warn(`[Weekly] Run ${result.runId}: ${phase} failed (${failure}); delivery unknown, automatic resend suppressed.`);
			return reply(202, { status: 'uncertain', phase, failure });
		}
	}
}
