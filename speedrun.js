import {
  doc, collection, query, orderBy, limit, where,
  getDocFromServer, getDocs, getCountFromServer, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  SPEEDRUN_EVENT_ID, SPEEDRUN_EVENT_TITLE, validRecord, isBetterRecord,
  formatTime, formatElapsedTime, rankRecords, eventStatus, createStopwatch, createPauseGate, isEventLink, eventDateParts,
} from './speedrun-core.js?v=20261116-speedrun-3';

const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el && el.textContent !== String(text)) el.textContent = text; };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const delayLimit = (promise, milliseconds = 15000) => {
  let timeout;
  return Promise.race([promise, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('connection-timeout')), milliseconds);
  })]).finally(() => clearTimeout(timeout));
};
const pauseIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>';
const playIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5a.6.6 0 0 1 .9-.5l7 4.5a.6.6 0 0 1 0 1l-7 4.5a.6.6 0 0 1-.9-.5z"/></svg>';

export function createSpeedrun(hooks) {
  return new Speedrun(hooks, isEventLink(location.search));
}

class Speedrun {
  constructor(hooks, eventLink) {
    this.hooks = hooks;
    this.db = hooks.db;
    this.eventLink = eventLink;
    this.autoOpened = false;
    this.mode = 'normal';
    this.phase = 'idle';
    this.config = null;
    this.uid = null;
    this.best = null;
    this.attempt = null;
    this.result = null;
    this.clock = createStopwatch();
    this.countdownClock = createStopwatch();
    this.pauseGate = createPauseGate(() => this.applyPauseState());
    this.busy = false;
    this.operation = 0;
    this.panelRequest = 0;
    this.fullRequest = 0;
    this.lastPaint = 0;
    this.confirmAction = null;
    this.pendingGuide = false;
    this.rankingReturn = null;
    this.originalMobileLabel = null;
    this.buildUI();
    this.installRankingTabs();
    this.bindUI();
    this.initialize();
    this.headerInterval = setInterval(() => { this.paintBanner(); this.maybeAutoOpen(); }, 10000);
  }

  isEventMode() { return this.mode === 'event'; }
  isRunning() { return this.isEventMode() && this.phase === 'running'; }
  isActiveAttempt() { return this.isEventMode() && ['countdown', 'running'].includes(this.phase); }
  isPaused() { return this.isActiveAttempt() && this.pauseGate.paused(); }
  pausesBoard() {
    return this.phase === 'countdown' || this.isPaused()
      || (!this.isEventMode() && ($('sr-guide').open || this.pendingGuide || this.rankingReturn === 'guide'));
  }
  allowsInput() {
    return (!this.isEventMode() || (this.isRunning() && !this.isPaused()))
      && !document.querySelector('.sr-dialog[open]');
  }

  refreshPauseReasons() {
    this.pauseGate.set('visibility', document.hidden);
    this.pauseGate.set('blur', !document.hasFocus());
    this.pauseGate.set('options', Boolean(document.querySelector('.mob-options-panel:not(.hidden)')));
    this.pauseGate.set('ranking', Boolean(document.querySelector('.full-ranking-panel:not(.hidden), .mobile-ranking-panel:not(.hidden)')));
    this.pauseGate.set('dialog', Boolean($('sr-guide').open || $('sr-confirm').open));
    this.applyPauseState();
  }

  applyPauseState() {
    const paused = this.isPaused();
    if (this.isActiveAttempt()) {
      if (paused) { this.clock.pause(); this.countdownClock.pause(); }
      else { this.clock.resume(); this.countdownClock.resume(); }
    }
    const overlay = $('sr-pause-overlay');
    if (overlay) overlay.hidden = !paused;
    const pauseButton = $('sr-pause');
    if (pauseButton) {
      pauseButton.disabled = !this.isActiveAttempt();
      const manual = this.pauseGate.has('manual');
      pauseButton.innerHTML = `${manual ? playIcon : pauseIcon}<span>${manual ? '계속하기' : '일시정지'}</span>`;
      pauseButton.setAttribute('aria-pressed', String(this.pauseGate.has('manual')));
    }
    setText('sr-clock-label', paused ? '일시정지' : this.phase === 'countdown' ? '시작 대기' : '경과 시간');
    $('sr-live')?.classList.toggle('is-paused', paused);
    this.hooks.pauseChanged?.();
  }

  togglePause() {
    if (!this.isActiveAttempt()) return;
    this.pauseGate.set('manual', !this.pauseGate.has('manual'));
  }

  buildUI() {
    const header = document.createElement('section');
    header.id = 'sr-header'; header.className = 'sr-header speedrun-ui'; header.hidden = true;
    header.innerHTML = '<button id="sr-entry" class="sr-entry" type="button">'
      + '<span class="sr-entry-mark" aria-hidden="true">🏆</span>'
      + '<span class="sr-entry-copy"><span id="sr-entry-note">기간 한정 · 총 100만 사이버머니</span>'
      + '<strong id="sr-entry-label">타임어택 이벤트 참가하기</strong></span>'
      + '<span class="sr-entry-arrow" aria-hidden="true">›</span></button>';
    $('canvas-wrap').before(header);

    const live = document.createElement('section');
    live.id = 'sr-live'; live.className = 'sr-live speedrun-ui'; live.hidden = true;
    live.setAttribute('aria-label', '이벤트 시간과 조작');
    live.innerHTML = '<div class="sr-timer-group"><span id="sr-clock-label">경과 시간</span>'
      + '<strong id="sr-clock" class="sr-clock" aria-label="경과 시간">00:00</strong></div>'
      + `<div class="sr-play-controls"><button id="sr-pause" type="button" aria-pressed="false">${pauseIcon}<span>일시정지</span></button>`
      + '<button id="sr-restart" type="button">처음부터</button></div>'
      + '<button id="sr-leave" class="sr-text-button" type="button">일반 게임하기</button>';
    $('canvas-wrap').after(live);

    const stats = document.createElement('section');
    stats.id = 'sr-stats'; stats.className = 'sr-stats speedrun-ui';
    stats.innerHTML = '<span>내 최고 기록</span><strong id="sr-best">—</strong>'
      + '<small id="sr-best-points"></small><hr><span>현재 큐포인트</span><strong id="sr-score">0P</strong>';
    document.querySelector('.left-panel .score-card').before(stats);

    const countdown = document.createElement('div');
    countdown.id = 'sr-countdown'; countdown.className = 'sr-countdown speedrun-ui'; countdown.hidden = true;
    countdown.innerHTML = '<strong id="sr-countdown-number">3</strong>';
    $('canvas-wrap').append(countdown);
    const pauseOverlay = document.createElement('div');
    pauseOverlay.id = 'sr-pause-overlay'; pauseOverlay.className = 'sr-pause-overlay speedrun-ui';
    pauseOverlay.hidden = true; pauseOverlay.textContent = '일시정지';
    $('canvas-wrap').append(pauseOverlay);

    const dialogs = document.createElement('div'); dialogs.className = 'speedrun-ui';
    dialogs.innerHTML = `
      <dialog id="sr-guide" class="sr-dialog" aria-labelledby="sr-guide-title">
        <button class="sr-close" data-sr="close-guide" type="button" aria-label="안내 닫기">✕</button>
        <h2 id="sr-guide-title">⏱ ${SPEEDRUN_EVENT_TITLE}</h2>
        <section class="sr-event-period" aria-label="이벤트 기간">
          <div class="sr-section-heading"><span>이벤트 기간</span><small>한국시간</small></div>
          <div class="sr-period-grid"><div><span>시작</span><strong id="sr-guide-start-date">—</strong><time id="sr-guide-start-time">—</time></div>
            <span class="sr-period-arrow" aria-hidden="true">→</span>
            <div><span>마감</span><strong id="sr-guide-end-date">—</strong><time id="sr-guide-end-time">—</time></div></div>
        </section>
        <section class="sr-prizes" aria-label="이벤트 상금">
          <div class="sr-section-heading"><span>이벤트 상금</span><small>사이버머니</small></div>
          <div class="sr-prize-grid"><div><span>1등</span><strong>50만</strong></div>
            <div><span>2등</span><strong>30만</strong></div><div><span>3등</span><strong>20만</strong></div></div>
        </section>
        <div class="sr-guide-player"><span>참여 닉네임</span><strong id="sr-guide-player"></strong>
          <button id="sr-change-nickname" class="sr-nickname-button" type="button">닉네임 변경하기</button>
          <small id="sr-guide-best" hidden></small></div>
        <ol class="sr-rules"><li><b>3초 카운트 후</b> 시작해요.</li>
          <li><b>1991 한 개를 만들면</b> 시간·점수가 기록돼요.</li>
          <li>빠른 시간순, 같은 시간은 높은 점수순이에요.</li>
          <li>재도전은 무제한! 최고 기록만 남아요.</li>
          <li>일시정지하거나 처음부터 다시 할 수 있어요.</li>
          <li>탭·앱 전환이나 옵션·랭킹창을 열면 자동 정지돼요.</li></ol>
        <p class="sr-precision">0.01초 기준 · 시간과 점수가 모두 같으면 공동 순위</p>
        <p id="sr-prepare-status" class="sr-status" role="status" hidden></p>
        <div class="sr-button-stack"><button id="sr-start" class="btn btn-orange" type="button" disabled>준비 중…</button>
          <button data-sr="ranks" class="btn btn-blue" type="button">이벤트 랭킹</button>
          <button data-sr="close-guide" class="sr-text-button" type="button">일반 게임하기</button></div>
        <button id="sr-pending" class="sr-text-button" type="button" hidden>대기 기록 등록</button>
      </dialog>
      <dialog id="sr-result" class="sr-dialog sr-result" aria-labelledby="sr-result-title">
        <span id="sr-result-emoji" class="sr-result-emoji">🎉</span><h2 id="sr-result-title">1991 완성!</h2>
        <span id="sr-result-time-label" class="sr-date">완성 기록</span><strong id="sr-result-time" class="sr-result-time"></strong>
        <p id="sr-result-score" class="sr-result-score"></p><p id="sr-result-best" class="sr-result-best"></p>
        <p id="sr-save-status" class="sr-status" role="status"></p><p id="sr-result-rank" class="sr-result-rank"></p>
        <div class="sr-button-stack"><button id="sr-result-retry" class="btn btn-orange" type="button">다시 도전</button>
          <button id="sr-save-retry" class="btn btn-ghost" type="button" hidden>다시 등록</button>
          <button data-sr="ranks" class="btn btn-blue" type="button">이벤트 랭킹</button>
          <button data-sr="normal" class="sr-text-button" type="button">일반 게임하기</button></div>
      </dialog>
      <dialog id="sr-confirm" class="sr-dialog sr-confirm" aria-labelledby="sr-confirm-title">
        <h2 id="sr-confirm-title">도전을 그만둘까요?</h2><p class="sr-note">현재 판의 기록은 저장되지 않아요.</p>
        <div class="sr-button-stack"><button id="sr-confirm-yes" class="btn btn-orange" type="button">일반 게임하기</button>
          <button data-sr="close-confirm" class="btn btn-ghost" type="button">계속하기</button></div>
      </dialog><div id="sr-toast" class="sr-toast" role="status" hidden></div>`;
    document.body.append(dialogs);
  }

  bindUI() {
    $('sr-entry').addEventListener('click', () => this.openGuide());
    $('sr-change-nickname').addEventListener('click', () => this.changeNickname());
    $('sr-start').addEventListener('click', () => this.beginAttempt());
    $('sr-result-retry').addEventListener('click', () => this.beginAttempt());
    $('sr-restart').addEventListener('click', () => this.requestRestart());
    $('sr-pause').addEventListener('click', () => this.togglePause());
    $('sr-leave').addEventListener('click', () => this.requestNormal());
    $('sr-save-retry').addEventListener('click', () => this.result && this.saveResult(this.result));
    $('sr-pending').addEventListener('click', () => this.retryPending());
    $('sr-confirm-yes').addEventListener('click', () => {
      const action = this.confirmAction; this.closeDialog('sr-confirm'); action?.();
    });
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-sr]')?.dataset.sr;
      if (action === 'close-guide') { this.operation++; this.closeDialog('sr-guide'); }
      if (action === 'close-confirm') this.closeDialog('sr-confirm');
      if (action === 'ranks') this.openRankings();
      if (action === 'normal') this.returnNormal();
    });
    ['sr-guide', 'sr-result', 'sr-confirm'].forEach(id => {
      $(id).addEventListener('close', () => this.refreshPauseReasons());
    });
    $('sr-guide').addEventListener('cancel', () => { this.operation++; });
    document.addEventListener('visibilitychange', () => this.refreshPauseReasons());
    window.addEventListener('blur', () => { this.pauseGate.set('blur', true); this.applyPauseState(); });
    window.addEventListener('focus', () => { this.refreshPauseReasons(); this.tick(performance.now()); });
  }

  installRankingTabs() {
    ['ranking-tabs', 'mobile-ranking-tabs'].forEach(id => {
      const container = $(id); if (!container) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ranking-tab-btn';
      button.dataset.rankMode = 'event'; button.textContent = '이벤트';
      button.style.cssText = 'min-width:0;cursor:pointer;';
      button.addEventListener('click', () => this.hooks.selectRanking('event'));
      container.append(button);
    });
  }

  async initialize() {
    try { await this.readConfig(); this.paintBanner(); this.maybeAutoOpen(); }
    catch (error) {
      console.warn('[스피드런] 설정 조회 실패:', error);
      $('sr-header').hidden = !this.eventLink;
    }
  }

  maybeAutoOpen() {
    if (this.autoOpened || eventStatus(this.config) !== 'open') return;
    this.autoOpened = true;
    this.openGuide();
  }

  async readConfig() {
    if (!this.db) throw new Error('firebase-unavailable');
    const snap = await delayLimit(getDocFromServer(doc(this.db, 'speedrunEvents', SPEEDRUN_EVENT_ID)));
    if (!snap.exists()) throw new Error('event-config-missing');
    const data = snap.data();
    this.config = { title: SPEEDRUN_EVENT_TITLE, enabled: data.enabled === true,
      startsAt: data.startsAt?.toMillis?.(), endsAt: data.endsAt?.toMillis?.() };
    const start = eventDateParts(this.config.startsAt), end = eventDateParts(this.config.endsAt);
    setText('sr-guide-start-date', start.date); setText('sr-guide-start-time', start.time);
    setText('sr-guide-end-date', end.date); setText('sr-guide-end-time', end.time);
    return this.config;
  }

  paintBanner() {
    const active = this.isEventMode();
    const status = eventStatus(this.config);
    $('sr-header').hidden = active || (status !== 'open' && !this.eventLink);
    $('sr-live').hidden = !active;
    setText('sr-entry-label', status === 'closed' ? '이벤트 결과 보기' : '타임어택 이벤트 참가하기');
    setText('sr-entry-note', status === 'closed' ? '1991 스피드런 이벤트' : '기간 한정 · 총 100만 사이버머니');
    document.querySelectorAll('[data-rank-mode="event"]').forEach(button => {
      button.hidden = status !== 'open' && !this.eventLink;
      button.parentElement.classList.toggle('sr-two-tabs', button.hidden);
    });
    $('sr-restart').disabled = this.busy || status !== 'open';
    this.applyPauseState();
  }

  async authenticate() {
    if (!this.authPromise) this.authPromise = (async () => {
      const { getAuth, onAuthStateChanged, signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      const auth = getAuth();
      const existing = await new Promise((resolve, reject) => {
        let unsubscribe;
        unsubscribe = onAuthStateChanged(auth, user => { unsubscribe?.(); resolve(user); }, reject);
      });
      const user = existing || (await signInAnonymously(auth)).user;
      this.uid = user.uid;
      return user;
    })().catch(error => { this.authPromise = null; throw error; });
    return delayLimit(this.authPromise);
  }

  async prepare() {
    await Promise.all([this.readConfig(), this.authenticate(), this.hooks.ready?.()]);
    if (eventStatus(this.config) !== 'open') throw new Error('event-not-open');
    const snap = await delayLimit(getDocFromServer(this.recordRef()));
    this.best = snap.exists() && validRecord(snap.data()) ? snap.data() : null;
    this.syncStats();
    return true;
  }

  setPreparationMessage(message) {
    setText('sr-prepare-status', message);
    $('sr-prepare-status').hidden = !message;
  }

  async openGuide({ returning = false } = {}) {
    this.autoOpened = true;
    if (!this.hooks.getState().nickname) {
      this.pendingGuide = true; this.hooks.showNickname(); return;
    }
    if (!returning && this.config && eventStatus(this.config) === 'closed') { this.openRankings(); return; }
    this.hooks.hideOverlays(); this.showDialog('sr-guide');
    setText('sr-guide-player', this.hooks.getState().nickname);
    this.setPreparationMessage('');
    $('sr-start').disabled = true; setText('sr-start', '준비 중…');
    const token = ++this.operation;
    try {
      await this.prepare();
      if (token !== this.operation || !$('sr-guide').open) return;
      setText('sr-guide-best', this.best ? `내 최고 ${formatTime(this.best.timeCs)}` : '');
      $('sr-guide-best').hidden = !this.best;
      $('sr-start').disabled = false; setText('sr-start', '도전 시작');
      $('sr-pending').hidden = !this.readPending();
      this.paintBanner();
    } catch (error) {
      if (token !== this.operation) return;
      this.setPreparationMessage(this.prepareMessage(error));
      const unavailable = error.message === 'event-not-open';
      $('sr-start').disabled = unavailable;
      setText('sr-start', unavailable ? (eventStatus(this.config) === 'scheduled' ? '시작 전' : '접수 종료') : '다시 시도');
    }
  }

  onNicknameConfirmed() {
    if (this.pendingGuide) { this.pendingGuide = false; this.openGuide(); }
  }

  changeNickname() {
    if (this.isActiveAttempt()) return;
    this.operation++; this.pendingGuide = true;
    this.closeDialog('sr-guide'); this.hooks.showNickname(); this.hooks.pauseChanged?.();
  }

  onNicknameCancelled() { this.onNicknameConfirmed(); }

  prepareMessage(error) {
    if (error.message === 'game-images-unavailable') return '얼굴 이미지를 불러오지 못했어요. 다시 시도해주세요.';
    if (error.message === 'event-not-open') {
      return eventStatus(this.config) === 'scheduled' ? '아직 이벤트 시작 전이에요.' : '이벤트 접수가 종료됐어요.';
    }
    return '연결하지 못했어요. 다시 시도해주세요.';
  }

  async beginAttempt() {
    if (this.busy) return;
    this.busy = true; this.pauseGate.set('preparing', true);
    const token = ++this.operation;
    ['sr-start', 'sr-result-retry', 'sr-restart'].forEach(id => { $(id).disabled = true; });
    setText('sr-start', '준비 중…');
    this.setPreparationMessage('');
    try {
      await this.prepare();
      if (token !== this.operation) return;
      const state = this.hooks.getState();
      if (!state.nickname) throw new Error('nickname-missing');
      this.closeAllDialogs(); this.hooks.hideOverlays();
      this.clock.stop(); this.countdownClock.stop();
      this.mode = 'event'; this.phase = 'countdown'; this.result = null;
      this.attempt = Object.freeze({ id: crypto.randomUUID(), eventId: SPEEDRUN_EVENT_ID,
        playerId: this.uid, nickname: state.nickname });
      this.pauseGate.clear();
      document.body.classList.add('speedrun-mode');
      this.hooks.resetBoard(); this.hooks.selectRanking('event');
      this.countdownClock.start();
      this.lastPaint = 0;
      setText('sr-clock', '00:00');
      setText('sr-countdown-number', '3'); $('sr-countdown').hidden = false;
      this.refreshPauseReasons(); this.syncStats(); this.paintBanner();
    } catch (error) {
      if (token !== this.operation) return;
      const message = this.prepareMessage(error);
      if ($('sr-guide').open) this.setPreparationMessage(message);
      else this.notice(message);
    } finally {
      this.busy = false; this.pauseGate.set('preparing', false);
      ['sr-start', 'sr-result-retry', 'sr-restart'].forEach(id => { $(id).disabled = false; });
      setText('sr-start', '도전 시작');
    }
  }

  tick(now) {
    if (!this.isActiveAttempt()) return;
    if (eventStatus(this.config) !== 'open') { this.finish('expired'); return; }
    if (this.isPaused()) return;
    if (this.phase === 'countdown') {
      const remaining = 3000 - this.countdownClock.readMs();
      if (remaining > 0) setText('sr-countdown-number', Math.ceil(remaining / 1000));
      else {
        this.countdownClock.stop(); this.phase = 'running'; this.clock.start();
        $('sr-countdown').hidden = true; this.applyPauseState();
      }
    }
    if (!this.isRunning()) return;
    const timeCs = this.clock.readCs();
    const second = Math.floor(timeCs / 100);
    if (second !== this.lastPaint) { setText('sr-clock', formatElapsedTime(timeCs)); this.lastPaint = second; }
  }

  complete() {
    if (!this.isRunning() || this.isPaused()) return;
    this.finish(eventStatus(this.config) === 'open' ? 'complete' : 'expired');
  }

  gameOver() { if (this.isEventMode()) this.finish('failed'); }

  finish(kind) {
    if (!this.isActiveAttempt()) return;
    const timeCs = this.phase === 'running' ? this.clock.stop() : 0;
    this.countdownClock.stop();
    const state = this.hooks.getState();
    const result = Object.freeze({ ...this.attempt, kind, timeCs, score: state.score });
    this.operation++; this.phase = 'finished'; this.result = result;
    this.pauseGate.clear(); $('sr-countdown').hidden = true;
    this.hooks.freezeBoard(); this.closeAllDialogs(); this.paintBanner();
    setText('sr-clock', formatElapsedTime(timeCs));
    setText('sr-result-emoji', kind === 'complete' ? '🎉' : kind === 'expired' ? '⏱' : '👄');
    setText('sr-result-title', kind === 'complete' ? '1991 완성!' : kind === 'expired' ? '이벤트가 종료됐어요' : '이번 도전 종료');
    setText('sr-result-time-label', kind === 'complete' ? '완성 기록' : '플레이 시간');
    setText('sr-result-time', formatTime(timeCs));
    setText('sr-result-score', `${result.score.toLocaleString()}P`);
    setText('sr-result-best', this.best ? `내 최고 ${formatTime(this.best.timeCs)} · ${this.best.score.toLocaleString()}P` : '');
    setText('sr-result-rank', '');
    setText('sr-save-status', kind === 'complete' ? '등록 중…' : kind === 'expired' ? '기록 접수가 마감됐어요.' : '1991을 완성하면 기록돼요.');
    $('sr-save-retry').hidden = true; $('sr-result-retry').hidden = kind === 'expired';
    this.showDialog('sr-result');
    if (kind === 'complete') this.saveResult(result);
  }

  recordRef() { return doc(this.db, 'speedrunEvents', SPEEDRUN_EVENT_ID, 'records', this.uid); }
  recordsCollection() { return collection(this.db, 'speedrunEvents', SPEEDRUN_EVENT_ID, 'records'); }
  pendingKey() { return `qplay_speedrun_pending_${SPEEDRUN_EVENT_ID}_${this.uid}`; }
  readPending() {
    try { const value = JSON.parse(localStorage.getItem(this.pendingKey())); return validRecord(value) ? value : null; }
    catch { return null; }
  }
  rememberPending(result) {
    try { if (isBetterRecord(result, this.readPending())) localStorage.setItem(this.pendingKey(), JSON.stringify(result)); }
    catch { /* Storage may be unavailable; the open result screen still has its frozen record. */ }
  }
  clearPending(best) {
    const pending = this.readPending();
    if (pending && !isBetterRecord(pending, best)) {
      try { localStorage.removeItem(this.pendingKey()); } catch { /* optional cache */ }
    }
  }

  async saveResult(result) {
    if (!validRecord(result) || result.playerId !== this.uid) return;
    // The result is immutable. Per-attempt pending promises prevent duplicate
    // submits without consulting the next game's mutable score or nickname.
    this.saves ??= new Map();
    if (this.saves.has(result.id)) return this.saves.get(result.id);
    this.rememberPending(result);
    const visible = () => this.result?.id === result.id && this.isEventMode();
    if (visible()) { setText('sr-save-status', '등록 중…'); $('sr-save-retry').hidden = true; }
    const work = (async () => {
      try {
        const payload = { eventId: result.eventId, playerId: result.playerId, nickname: result.nickname,
          timeCs: result.timeCs, score: result.score };
        const saved = await delayLimit(runTransaction(this.db, async transaction => {
          const ref = doc(this.db, 'speedrunEvents', result.eventId, 'records', result.playerId);
          const snap = await transaction.get(ref);
          const previous = snap.exists() ? snap.data() : null;
          if (!isBetterRecord(payload, previous)) return { changed: false, best: previous };
          transaction.set(ref, { ...payload, updatedAt: serverTimestamp() });
          return { changed: true, best: payload };
        }));
        if (isBetterRecord(saved.best, this.best)) this.best = saved.best;
        this.clearPending(saved.best); this.syncStats();
        if (visible()) {
          setText('sr-save-status', saved.changed ? '등록 완료' : '최고 기록 유지');
          setText('sr-result-best', saved.changed ? '최고 기록 경신!' : `내 최고 기록 ${formatTime(saved.best.timeCs)} · ${saved.best.score.toLocaleString()}P`);
          this.myRank(saved.best).then(rank => {
            if (visible()) setText('sr-result-rank', `이벤트 ${rank}위`);
          }).catch(() => { /* A saved result stays saved even if rank loading fails. */ });
        }
        if (this.hooks.getRankingMode() === 'event') this.loadRankingPanel();
      } catch (error) {
        console.warn('[스피드런] 기록 등록 실패:', error);
        if (visible()) {
          setText('sr-save-status', '등록하지 못했어요. 다시 시도해주세요.');
          $('sr-save-retry').hidden = false;
        }
      }
    })().finally(() => this.saves.delete(result.id));
    this.saves.set(result.id, work);
    return work;
  }

  async retryPending() {
    const pending = this.readPending(); if (!pending) return;
    await this.saveResult(pending);
    $('sr-pending').hidden = !this.readPending();
    this.setPreparationMessage(this.readPending() ? '아직 등록하지 못했어요. 연결과 이벤트 기간을 확인해주세요.' : '대기 기록을 확인했어요.');
  }

  syncStats() {
    const state = this.hooks.getState();
    setText('sr-best', this.best ? formatTime(this.best.timeCs) : '—');
    setText('sr-best-points', this.best ? `${this.best.score.toLocaleString()}P` : '');
    setText('sr-score', `${state.score.toLocaleString()}P`);
    const bestGroup = $('mob-best')?.closest('.mob-score-group');
    const wmGroup = $('mob-wm')?.closest('.mob-score-group');
    if (wmGroup) wmGroup.classList.toggle('sr-hide-stat', this.isEventMode());
    if (bestGroup) {
      const label = bestGroup.querySelector('.mob-label');
      if (this.originalMobileLabel === null && label) this.originalMobileLabel = label.textContent;
      if (label) label.textContent = this.isEventMode() ? '내 최고 시간' : this.originalMobileLabel;
    }
    if (this.isEventMode()) setText('mob-best', this.best ? formatTime(this.best.timeCs) : '—');
  }

  async myRank(record) {
    const coll = this.recordsCollection();
    const [faster, sameTimeHigher] = await Promise.all([
      getCountFromServer(query(coll, where('timeCs', '<', record.timeCs))),
      getCountFromServer(query(coll, where('timeCs', '==', record.timeCs), where('score', '>', record.score), orderBy('score', 'desc'))),
    ]);
    return faster.data().count + sameTimeHigher.data().count + 1;
  }

  rankingRow(record, full = false) {
    return `<div class="sr-rank-row${record.playerId === this.uid ? ' sr-me' : ''}${full ? ' sr-rank-full' : ''}">
      <span class="sr-place">${record.rank}</span><span class="sr-who"><b>${escapeHtml(record.nickname)}</b><small>${record.score.toLocaleString()}P</small></span>
      <strong class="sr-rank-time">${formatTime(record.timeCs)}</strong></div>`;
  }

  async loadRankingPanel() {
    const seq = ++this.panelRequest;
    const isCurrent = () => seq === this.panelRequest && this.hooks.getRankingMode() === 'event';
    this.paintRankingButton(null, true);
    const ids = ['ranking-list', 'mobile-ranking-list'];
    ids.forEach(id => { $(id).innerHTML = '<p class="sr-rank-empty">이벤트 기록을 불러오는 중…</p>'; });
    try {
      const snap = await delayLimit(getDocs(query(this.recordsCollection(), orderBy('timeCs', 'asc'), orderBy('score', 'desc'), limit(10))));
      if (!isCurrent()) return;
      const rows = rankRecords(snap.docs.map(item => item.data()));
      let own = null;
      if (this.uid && !rows.some(row => row.playerId === this.uid)) {
        const mySnap = await getDocFromServer(this.recordRef());
        if (mySnap.exists() && validRecord(mySnap.data())) {
          const data = mySnap.data(); own = { ...data, rank: await this.myRank(data) };
        }
      }
      if (!isCurrent()) return;
      const html = (rows.length ? rows.map(row => this.rankingRow(row)).join('') : '<p class="sr-rank-empty">첫 1991 완성 기록을 기다리고 있어요!</p>')
        + (own ? `<div class="rank-divider"></div>${this.rankingRow(own)}` : '');
      ids.forEach(id => { $(id).innerHTML = html; });
      this.paintRankingButton(rows[0]);
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('[스피드런] 랭킹 조회 실패:', error);
      ids.forEach(id => { $(id).innerHTML = '<p class="sr-rank-empty">기록을 불러오지 못했어요.<br>이벤트 탭을 다시 눌러주세요.</p>'; });
      this.paintRankingButton();
    }
  }

  paintRankingButton(leader, loading = false) {
    $('mob-ranking-btn').innerHTML = '<span class="rank-btn-title">🏆 이벤트 랭킹</span>'
      + `<span class="rank-btn-leader">${leader ? `1위 ${formatTime(leader.timeCs)}` : loading ? '기록 확인 중…' : '첫 기록을 기다려요'}</span>`;
  }

  async loadFullRanking() {
    const seq = ++this.fullRequest;
    const isCurrent = () => seq === this.fullRequest && this.hooks.getRankingMode() === 'event';
    document.querySelector('.full-ranking-title').textContent = '⏱ 이벤트 TOP 50';
    document.querySelector('.full-ranking-sub').textContent = '완성 시간순 · 동시간은 점수순 · 점수까지 같으면 공동 순위';
    $('full-ranking-list').innerHTML = '<p class="sr-rank-empty">기록을 불러오는 중…</p>';
    try {
      const snap = await delayLimit(getDocs(query(this.recordsCollection(), orderBy('timeCs', 'asc'), orderBy('score', 'desc'), limit(50))));
      if (!isCurrent()) return;
      const rows = rankRecords(snap.docs.map(item => item.data()));
      $('full-ranking-list').innerHTML = rows.length ? rows.map(row => this.rankingRow(row, true)).join('')
        : '<p class="sr-rank-empty">첫 1991 완성 기록을 기다리고 있어요!</p>';
    } catch (error) {
      if (!isCurrent()) return;
      $('full-ranking-list').innerHTML = '<p class="sr-rank-empty">불러오지 못했어요. 창을 닫고 다시 열어주세요.</p>';
    }
  }

  openRankings() {
    const returnTo = $('sr-guide').open ? 'guide' : $('sr-result').open ? 'result' : null;
    this.closeDialog('sr-guide'); this.closeDialog('sr-result');
    this.hooks.selectRanking('event'); this.hooks.showFullRanking(returnTo);
  }

  onRankingOpened(returnTo) {
    this.rankingReturn = returnTo;
    setText('full-ranking-close', returnTo ? '돌아가기' : '✕ 닫기');
  }

  onRankingClosed() {
    const returnTo = this.rankingReturn; this.rankingReturn = null;
    if (returnTo === 'guide') this.openGuide({ returning: true });
    else if (returnTo === 'result') this.showDialog('sr-result');
    this.refreshPauseReasons();
  }

  requestRestart() { this.beginAttempt(); }

  requestNormal() {
    if (['running', 'countdown'].includes(this.phase)) {
      this.askConfirmation('도전을 그만둘까요?', '일반 게임하기', () => this.returnNormal());
    } else this.returnNormal();
  }
  askConfirmation(title, actionLabel, action) {
    setText('sr-confirm-title', title); setText('sr-confirm-yes', actionLabel);
    this.confirmAction = action; this.hooks.hideOverlays(); this.showDialog('sr-confirm');
  }
  returnNormal() {
    this.rankingReturn = null;
    this.operation++; this.clock.stop(); this.countdownClock.stop(); this.mode = 'normal'; this.phase = 'idle';
    this.pauseGate.clear();
    this.closeAllDialogs(); $('sr-countdown').hidden = true;
    document.body.classList.remove('speedrun-mode');
    this.hooks.resetBoard(); this.syncStats(); this.paintBanner();
    this.hooks.selectRanking('today');
  }
  showDialog(id) { const el = $(id); if (!el.open) el.showModal(); this.refreshPauseReasons(); }
  closeDialog(id) { const el = $(id); if (el.open) el.close(); this.refreshPauseReasons(); }
  closeAllDialogs() { ['sr-guide', 'sr-result', 'sr-confirm'].forEach(id => this.closeDialog(id)); }
  notice(message) {
    setText('sr-toast', message); $('sr-toast').hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { $('sr-toast').hidden = true; }, 4000);
  }
}
