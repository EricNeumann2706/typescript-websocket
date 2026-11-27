import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeeklyChallenge } from '../src/helpers/weekly-challenge-helper.ts';

test('all times within a UTC week use the same identifier and seed', () => {
	const monday = getWeeklyChallenge(Date.parse('2026-11-23T00:00:00Z'));
	const sunday = getWeeklyChallenge(Date.parse('2026-11-29T23:59:59.999Z'));
	assert.equal(monday.identifier, 'weekly_2026-11-23');
	assert.equal(sunday.identifier, monday.identifier);
	assert.equal(sunday.seed, monday.seed);
	assert.equal(monday.firstIndex, monday.index);
	assert.equal(monday.endsAt - monday.startsAt, 7 * 24 * 60 * 60);
});

test('Monday midnight advances the seed and identifier together', () => {
	const previous = getWeeklyChallenge(Date.parse('2026-11-29T23:59:59.999Z'));
	const next = getWeeklyChallenge(Date.parse('2026-11-30T00:00:00Z'));
	assert.equal(next.identifier, 'weekly_2026-11-30');
	assert.equal(next.index, previous.index + 1);
	assert.equal(next.seed, previous.seed + 1);
	assert.equal(next.startsAt, previous.endsAt);
});

test('calendar years and local daylight saving do not shift UTC week boundaries', () => {
	for (const [time, expected] of [
		['2027-01-01T12:00:00Z', 'weekly_2026-12-28'],
		['2027-03-28T23:59:59Z', 'weekly_2027-03-22'],
		['2027-03-29T00:00:00Z', 'weekly_2027-03-29'],
	]) assert.equal(getWeeklyChallenge(Date.parse(time)).identifier, expected);
});
