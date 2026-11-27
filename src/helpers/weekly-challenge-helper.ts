const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const MONDAY_EPOCH = Date.parse('1970-01-05T00:00:00Z');
const FIRST_WEEKLY_CHALLENGE = Date.parse('2026-11-23T00:00:00Z');

export function getWeeklyChallenge(now = Date.now()) {
	const index = Math.floor((now - MONDAY_EPOCH) / WEEK_MILLISECONDS);
	const startsAt = MONDAY_EPOCH + index * WEEK_MILLISECONDS;
	return {
		identifier: 'weekly_' + new Date(startsAt).toISOString().slice(0, 10),
		seed: index,
		index,
		firstIndex: Math.floor((FIRST_WEEKLY_CHALLENGE - MONDAY_EPOCH) / WEEK_MILLISECONDS),
		startsAt: startsAt / 1000,
		endsAt: (startsAt + WEEK_MILLISECONDS) / 1000,
		serverTime: now / 1000,
	};
}
