// Shared event rules. A record is compared at the same 0.01-second precision
// that is shown to the player. Keep the time and score from the SAME attempt.
export const SPEEDRUN_EVENT_ID = 'speedrun_test';
// During testing, the event is visible only at ?speedrun=test.
// Change this to false when a real event document and its dates are ready.
export const SPEEDRUN_TEST_ONLY = true;

export function validRecord(value) {
  return Boolean(value && Number.isSafeInteger(value.timeCs) && value.timeCs > 0
    && Number.isSafeInteger(value.score) && value.score >= 0 && value.score <= 999999);
}

export function isBetterRecord(next, previous) {
  if (!validRecord(next)) return false;
  if (!validRecord(previous)) return true;
  return next.timeCs < previous.timeCs
    || (next.timeCs === previous.timeCs && next.score > previous.score);
}

export function sameRank(a, b) {
  return a.timeCs === b.timeCs && a.score === b.score;
}

export function rankRecords(items) {
  const sorted = items.filter(validRecord).slice().sort((a, b) =>
    a.timeCs - b.timeCs || b.score - a.score);
  let rank = 0;
  return sorted.map((item, index) => {
    if (index === 0 || !sameRank(item, sorted[index - 1])) rank = index + 1;
    return { ...item, rank };
  });
}

export function formatTime(timeCs) {
  if (!Number.isSafeInteger(timeCs) || timeCs < 0) return '—';
  const minutes = Math.floor(timeCs / 6000);
  const seconds = Math.floor(timeCs / 100) % 60;
  const centis = timeCs % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function eventStatus(config, now = Date.now()) {
  if (!config || !config.enabled || !Number.isFinite(config.startsAt)
    || !Number.isFinite(config.endsAt) || config.startsAt >= config.endsAt) return 'disabled';
  if (now < config.startsAt) return 'scheduled';
  return now >= config.endsAt ? 'closed' : 'open';
}

export function createStopwatch(perf = () => performance.now(), wall = () => Date.now()) {
  let startPerf = 0, startWall = 0, last = 0, running = false;
  return {
    start() { startPerf = perf(); startWall = wall(); last = 0; running = true; },
    readCs() {
      if (running) {
        // The monotonic clock handles wall-clock rollback. The wall clock also
        // counts sleep on platforms whose performance clock stops while asleep.
        last = Math.max(last, Math.floor(Math.max(perf() - startPerf, wall() - startWall, 0) / 10));
      }
      return last;
    },
    stop() { const result = this.readCs(); running = false; return result; },
  };
}
