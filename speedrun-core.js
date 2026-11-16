// Shared event rules. A record is compared at the same 0.01-second precision
// that is shown to the player. Keep the time and score from the SAME attempt.
export const SPEEDRUN_EVENT_ID = 'speedrun_test';
export const SPEEDRUN_EVENT_TITLE = '1991 스피드런 이벤트';

export function isEventLink(search = '') {
  return ['event', 'test'].includes(new URLSearchParams(search).get('speedrun'));
}

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

// The live clock is deliberately calm; the result/ranking keeps centiseconds.
export function formatElapsedTime(timeCs) {
  return formatTime(timeCs).replace(/\.[0-9]{2}$/, '');
}

export function createPauseGate(onChange = () => {}) {
  const reasons = new Set();
  return {
    paused: () => reasons.size > 0,
    has: reason => reasons.has(reason),
    set(reason, active) {
      const before = reasons.has(reason);
      if (active) reasons.add(reason); else reasons.delete(reason);
      if (before !== Boolean(active)) onChange(reasons.size > 0);
    },
    clear() { if (reasons.size) { reasons.clear(); onChange(false); } },
  };
}

export function eventStatus(config, now = Date.now()) {
  if (!config || !config.enabled || !Number.isFinite(config.startsAt)
    || !Number.isFinite(config.endsAt) || config.startsAt >= config.endsAt) return 'disabled';
  if (now < config.startsAt) return 'scheduled';
  return now >= config.endsAt ? 'closed' : 'open';
}

export function createStopwatch(perf = () => performance.now(), wall = () => Date.now()) {
  let startPerf = 0, startWall = 0, accumulated = 0, last = 0;
  let running = false, started = false;
  return {
    start() {
      startPerf = perf(); startWall = wall(); accumulated = 0; last = 0;
      running = true; started = true;
    },
    readMs() {
      if (running) {
        last = Math.max(last, accumulated + Math.max(perf() - startPerf, wall() - startWall, 0));
      }
      return last;
    },
    readCs() { return Math.floor(this.readMs() / 10); },
    pause() { accumulated = this.readMs(); running = false; },
    resume() {
      if (!started || running) return;
      startPerf = perf(); startWall = wall(); running = true;
    },
    stop() { this.pause(); started = false; return this.readCs(); },
  };
}
