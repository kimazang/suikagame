import {
  doc, collection, query, orderBy, limit, where,
  getDocFromServer, getDocs, getCountFromServer, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  SPEEDRUN_EVENT_ID, SPEEDRUN_TEST_ONLY, validRecord, isBetterRecord,
  formatTime, rankRecords, eventStatus, createStopwatch,
} from './speedrun-core.js?v=20261116-speedrun-1';

const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const delayLimit = (promise, milliseconds = 15000) => {
  let timeout;
  return Promise.race([promise, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('connection-timeout')), milliseconds);
  })]).finally(() => clearTimeout(timeout));
};
const dateLabel = value => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));

export function createSpeedrun(hooks) {
  const testLink = new URLSearchParams(location.search).get('speedrun') === 'test';
  if (SPEEDRUN_TEST_ONLY && !testLink) return null;
  return new Speedrun(hooks, testLink);
}

class Speedrun {
  constructor(hooks, testLink) {
    this.hooks = hooks;
    this.db = hooks.db;
    this.testLink = testLink;
    this.mode = 'normal';
    this.phase = 'idle';
    this.config = null;
    this.uid = null;
    this.best = null;
    this.attempt = null;
    this.result = null;
    this.clock = createStopwatch();
    this.busy = false;
    this.operation = 0;
    this.panelRequest = 0;
    this.fullRequest = 0;
    this.lastPaint = 0;
    this.countdownEnd = 0;
    this.confirmAction = null;
    this.pendingGuide = false;
    this.originalMobileLabel = null;
    this.buildUI();
    this.installRankingTabs();
    this.bindUI();
    this.initialize();
    this.headerInterval = setInterval(() => this.paintBanner(), 30000);
  }

  isEventMode() { return this.mode === 'event'; }
  isRunning() { return this.isEventMode() && this.phase === 'running'; }
  pausesBoard() {
    return this.phase === 'countdown' || (!this.isEventMode() && $('sr-guide').open);
  }
  allowsInput() {
    return (!this.isEventMode() || this.phase === 'running')
      && !document.querySelector('.sr-dialog[open]');
  }

  buildUI() {
    const header = document.createElement('section');
    header.id = 'sr-header';
    header.className = 'sr-header speedrun-ui';
    header.setAttribute('aria-label', '1991 스피드런 이벤트');
    header.innerHTML = `
      <div id="sr-promo" class="sr-promo">
        <div class="sr-promo-copy"><span class="sr-eyebrow">${SPEEDRUN_TEST_ONLY ? 'TEST · 테스트 링크 전용' : '기간 한정 이벤트'}</span>
          <strong>1991 하나, 몇 분 컷?</strong><small id="sr-period">이벤트 안내를 불러오는 중…</small></div>
        <button id="sr-entry" class="btn btn-orange sr-entry" type="button" disabled>준비 중…</button>
      </div>
      <div id="sr-live" class="sr-live" hidden>
        <div><span id="sr-running-label" class="sr-eyebrow">⏱ 1991 스피드런</span>
          <strong id="sr-clock" class="sr-clock" aria-label="경과 시간">00:00.00</strong></div>
        <div class="sr-live-actions"><button id="sr-live-retry" class="btn btn-orange btn-sm" type="button" hidden>다시 도전</button>
          <button id="sr-leave" class="sr-text-button" type="button">일반 게임으로</button></div>
        <small id="sr-live-help">1991 한 개를 완성하면 기록이 확정돼요.</small>
      </div>`;
    $('canvas-wrap').before(header);

    const stats = document.createElement('section');
    stats.id = 'sr-stats';
    stats.className = 'sr-stats speedrun-ui';
    stats.innerHTML = '<span>내 최고 기록</span><strong id="sr-best">첫 기록에 도전!</strong>'
      + '<small id="sr-best-points"></small><hr><span>현재 큐포인트</span><strong id="sr-score">0P</strong>'
      + '<small>👄 목표: 1991 한 개 완성</small>';
    document.querySelector('.left-panel .score-card').before(stats);

    const countdown = document.createElement('div');
    countdown.id = 'sr-countdown';
    countdown.className = 'sr-countdown speedrun-ui';
    countdown.hidden = true;
    countdown.innerHTML = '<span>준비됐나요?</span><strong id="sr-countdown-number">3</strong>';
    $('canvas-wrap').append(countdown);

    const dialogs = document.createElement('div');
    dialogs.className = 'speedrun-ui';
    dialogs.innerHTML = `
      <dialog id="sr-guide" class="sr-dialog" aria-labelledby="sr-guide-title">
        <button class="sr-close" data-sr="close-guide" type="button" aria-label="안내 닫기">✕</button>
        <span class="sr-eyebrow">${SPEEDRUN_TEST_ONLY ? 'TEST · 기록은 테스트 랭킹에 저장돼요' : '기간 한정 이벤트'}</span>
        <h2 id="sr-guide-title">⏱ 1991 스피드런</h2>
        <p class="sr-intro">첫 1991, 얼마나 빨리 만들 수 있나요?</p>
        <ol class="sr-rules"><li>3초 카운트가 끝나면 도전이 시작돼요.</li>
          <li><b>1991 한 개를 완성한 순간</b> 시간과 점수가 확정돼요.</li>
          <li>시간이 빠른 순, 같은 시간이면 점수가 높은 순이에요.<br><small>0.01초 단위로 비교하며, 점수까지 같으면 공동 순위예요.</small></li>
          <li>여러 번 도전할 수 있고, 가장 좋은 기록이 남아요.</li></ol>
        <p class="sr-note">다른 탭·앱으로 이동하거나 옵션·랭킹을 열어도 시간은 계속 흘러요.</p>
        <p id="sr-guide-period" class="sr-date"></p>
        <p class="sr-date">마감 시각까지 등록이 완료된 기록을 집계해요.</p>
        <div class="sr-guide-player"><span id="sr-guide-player"></span><b id="sr-guide-best"></b></div>
        <p class="sr-note">도전을 시작하면 진행 중인 게임이 초기화돼요.</p>
        <p id="sr-prepare-status" class="sr-status" role="status"></p>
        <div class="sr-button-stack"><button id="sr-start" class="btn btn-orange" type="button" disabled>참가 준비 중…</button>
          <button data-sr="ranks" class="btn btn-blue" type="button">🏆 이벤트 랭킹</button>
          <button data-sr="close-guide" class="sr-text-button" type="button">돌아가기</button></div>
        <button id="sr-pending" class="sr-text-button" type="button" hidden>등록 대기 기록 다시 보내기</button>
      </dialog>
      <dialog id="sr-result" class="sr-dialog sr-result" aria-labelledby="sr-result-title">
        <span id="sr-result-emoji" class="sr-result-emoji">🎉</span><h2 id="sr-result-title">1991 완성!</h2>
        <span id="sr-result-time-label" class="sr-date">완성 기록</span><strong id="sr-result-time" class="sr-result-time"></strong>
        <p id="sr-result-score" class="sr-result-score"></p><p id="sr-result-best" class="sr-result-best"></p>
        <p id="sr-save-status" class="sr-status" role="status"></p><p id="sr-result-rank" class="sr-result-rank"></p>
        <div class="sr-button-stack"><button id="sr-result-retry" class="btn btn-orange" type="button">🔄 다시 도전</button>
          <button id="sr-save-retry" class="btn btn-ghost" type="button" hidden>기록 등록 다시 시도</button>
          <button data-sr="ranks" class="btn btn-blue" type="button">🏆 이벤트 랭킹</button>
          <button data-sr="normal" class="sr-text-button" type="button">일반 게임으로</button></div>
      </dialog>
      <dialog id="sr-confirm" class="sr-dialog sr-confirm" aria-labelledby="sr-confirm-title">
        <h2 id="sr-confirm-title">새로 도전할까요?</h2><p class="sr-intro">지금 진행 중인 도전은 기록으로 남지 않아요.</p>
        <div class="sr-button-stack"><button id="sr-confirm-yes" class="btn btn-orange" type="button">새로 도전</button>
          <button data-sr="close-confirm" class="btn btn-ghost" type="button">계속하기</button></div>
      </dialog><div id="sr-toast" class="sr-toast" role="status" hidden></div>`;
    document.body.append(dialogs);
  }

  bindUI() {
    $('sr-entry').addEventListener('click', () => this.openGuide());
    $('sr-start').addEventListener('click', () => this.beginAttempt());
    $('sr-result-retry').addEventListener('click', () => this.beginAttempt());
    $('sr-live-retry').addEventListener('click', () => this.beginAttempt());
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
    $('sr-guide').addEventListener('cancel', () => { this.operation++; });
    document.addEventListener('visibilitychange', () => {
      if (this.phase === 'countdown' && document.hidden) this.countdownEnd = Infinity;
      if (this.phase === 'countdown' && !document.hidden) this.countdownEnd = performance.now() + 3000;
      if (this.isRunning() && !document.hidden) this.tick(performance.now());
    });
  }

  installRankingTabs() {
    ['ranking-tabs', 'mobile-ranking-tabs'].forEach(id => {
      const container = $(id); if (!container) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ranking-tab-btn';
      button.dataset.rankMode = 'event'; button.textContent = 'EVENT';
      button.style.cssText = 'flex:1;border:0;border-radius:999px;padding:8px 6px;font-weight:800;cursor:pointer;';
      button.addEventListener('click', () => this.hooks.selectRanking('event'));
      container.append(button);
    });
  }

  async initialize() {
    try { await this.readConfig(); this.paintBanner(); }
    catch (error) {
      console.warn('[스피드런] 설정 조회 실패:', error);
      setText('sr-period', '이벤트 안내를 불러오지 못했어요.');
      setText('sr-entry', '다시 확인'); $('sr-entry').disabled = false;
    }
  }

  async readConfig() {
    if (!this.db) throw new Error('firebase-unavailable');
    const snap = await delayLimit(getDocFromServer(doc(this.db, 'speedrunEvents', SPEEDRUN_EVENT_ID)));
    if (!snap.exists()) throw new Error('event-config-missing');
    const data = snap.data();
    this.config = { title: typeof data.title === 'string' ? data.title : '1991 스피드런',
      enabled: data.enabled === true, startsAt: data.startsAt?.toMillis?.(), endsAt: data.endsAt?.toMillis?.() };
    setText('sr-guide-title', `⏱ ${this.config.title}`);
    return this.config;
  }

  paintBanner() {
    if (!$('sr-header')) return;
    const active = this.isEventMode();
    $('sr-promo').hidden = active; $('sr-live').hidden = !active;
    if (!this.config) return;
    const status = eventStatus(this.config);
    setText('sr-period', status === 'disabled' ? '지금은 이벤트 접수를 준비하고 있어요.'
      : `${dateLabel(this.config.startsAt)} ~ ${dateLabel(this.config.endsAt)} · 한국시간`);
    $('sr-entry').disabled = false;
    setText('sr-entry', status === 'open' ? '⏱ 이벤트 참여' : status === 'closed' ? '최종 랭킹' : '이벤트 안내');
    if (active) {
      $('sr-live-retry').hidden = this.phase !== 'finished';
      setText('sr-running-label', this.phase === 'running' ? '⏱ 1991 완성까지 도전 중' : this.phase === 'countdown' ? '⏱ 잠시 후 시작해요' : '⏱ 1991 스피드런');
      setText('sr-live-help', this.phase === 'finished' ? '다시 도전해서 기록을 줄여보세요.' : '1991 한 개를 완성하면 기록이 확정돼요.');
    }
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
    await Promise.all([this.readConfig(), this.authenticate()]);
    if (eventStatus(this.config) !== 'open') throw new Error('event-not-open');
    const snap = await delayLimit(getDocFromServer(this.recordRef()));
    this.best = snap.exists() && validRecord(snap.data()) ? snap.data() : null;
    this.syncStats();
    return true;
  }

  async openGuide() {
    if (!this.hooks.getState().nickname) {
      this.pendingGuide = true; this.hooks.showNickname(); return;
    }
    if (this.config && eventStatus(this.config) === 'closed') { this.openRankings(); return; }
    this.hooks.hideOverlays();
    this.showDialog('sr-guide');
    setText('sr-guide-player', `참여 닉네임: ${this.hooks.getState().nickname}`);
    setText('sr-prepare-status', '참가 준비 중…');
    $('sr-start').disabled = true; setText('sr-start', '참가 준비 중…');
    const token = ++this.operation;
    try {
      await this.prepare();
      if (token !== this.operation || !$('sr-guide').open) return;
      setText('sr-guide-period', `${dateLabel(this.config.startsAt)} ~ ${dateLabel(this.config.endsAt)} · 한국시간`);
      setText('sr-guide-best', this.best ? `내 최고 ${formatTime(this.best.timeCs)}` : '첫 기록에 도전해보세요!');
      setText('sr-prepare-status', '준비됐어요. 도전 시작을 눌러주세요.');
      $('sr-start').disabled = false; setText('sr-start', '도전 시작');
      $('sr-pending').hidden = !this.readPending();
      this.paintBanner();
    } catch (error) {
      if (token !== this.operation) return;
      setText('sr-prepare-status', this.prepareMessage(error));
      $('sr-start').disabled = false; setText('sr-start', '다시 준비하기');
    }
  }

  onNicknameConfirmed() {
    if (this.pendingGuide) { this.pendingGuide = false; this.openGuide(); }
  }

  prepareMessage(error) {
    if (error.message === 'event-not-open') {
      return eventStatus(this.config) === 'scheduled' ? '아직 이벤트 시작 전이에요.' : '지금은 이벤트 기록을 접수하지 않아요.';
    }
    if (error.code === 'auth/operation-not-allowed') return '참가 인증을 시작하지 못했어요. 운영자에게 알려주세요.';
    return '참가 준비에 연결이 필요해요. 인터넷 연결을 확인하고 다시 눌러주세요.';
  }

  async beginAttempt() {
    if (this.busy) return;
    this.busy = true;
    const token = ++this.operation;
    ['sr-start', 'sr-result-retry', 'sr-live-retry'].forEach(id => { $(id).disabled = true; });
    setText('sr-prepare-status', '시작 준비 중…');
    try {
      await this.prepare();
      if (token !== this.operation) return;
      const state = this.hooks.getState();
      if (!state.nickname) throw new Error('nickname-missing');
      this.closeAllDialogs(); this.hooks.hideOverlays();
      this.mode = 'event'; this.phase = 'countdown'; this.result = null;
      this.attempt = Object.freeze({ id: crypto.randomUUID(), eventId: SPEEDRUN_EVENT_ID,
        playerId: this.uid, nickname: state.nickname });
      document.body.classList.add('speedrun-mode');
      this.hooks.resetBoard();
      this.hooks.selectRanking('event');
      this.countdownEnd = performance.now() + 3000;
      this.lastPaint = 0;
      setText('sr-clock', '00:00.00');
      setText('sr-countdown-number', '3'); $('sr-countdown').hidden = false;
      this.syncStats(); this.paintBanner();
    } catch (error) {
      if (token !== this.operation) return;
      const message = this.prepareMessage(error);
      if ($('sr-guide').open) setText('sr-prepare-status', message);
      else this.notice(message);
    } finally {
      this.busy = false;
      ['sr-start', 'sr-result-retry', 'sr-live-retry'].forEach(id => { $(id).disabled = false; });
      setText('sr-start', '도전 시작');
    }
  }

  tick(now) {
    if (this.phase === 'countdown') {
      if (eventStatus(this.config) !== 'open') { this.finish('expired'); return; }
      const remaining = this.countdownEnd - now;
      if (remaining > 0) {
        setText('sr-countdown-number', Number.isFinite(remaining) ? Math.ceil(remaining / 1000) : '3');
      } else {
        this.phase = 'running'; this.clock.start();
        $('sr-countdown').hidden = true; this.paintBanner();
      }
    }
    if (!this.isRunning()) return;
    if (eventStatus(this.config) !== 'open') { this.finish('expired'); return; }
    const timeCs = this.clock.readCs();
    if (now - this.lastPaint >= 50) { setText('sr-clock', formatTime(timeCs)); this.lastPaint = now; }
  }

  complete() {
    if (!this.isRunning()) return;
    this.finish(eventStatus(this.config) === 'open' ? 'complete' : 'expired');
  }

  gameOver() { if (this.isEventMode()) this.finish('failed'); }

  finish(kind) {
    if (!this.isEventMode() || !['running', 'countdown'].includes(this.phase)) return;
    const timeCs = this.phase === 'running' ? this.clock.stop() : 0;
    const state = this.hooks.getState();
    const result = Object.freeze({ ...this.attempt, kind, timeCs, score: state.score });
    this.operation++; this.phase = 'finished'; this.result = result;
    $('sr-countdown').hidden = true;
    this.hooks.freezeBoard(); this.closeAllDialogs(); this.paintBanner();
    setText('sr-clock', formatTime(timeCs));
    setText('sr-result-emoji', kind === 'complete' ? '🎉' : kind === 'expired' ? '⏱' : '👄');
    setText('sr-result-title', kind === 'complete' ? '1991 완성!' : kind === 'expired' ? '이벤트 접수가 마감됐어요' : '이번 도전은 여기까지!');
    setText('sr-result-time-label', kind === 'complete' ? '완성 기록' : '플레이 시간');
    setText('sr-result-time', formatTime(timeCs));
    setText('sr-result-score', `${kind === 'complete' ? '완성 점수' : '이번 점수'} ${result.score.toLocaleString()}P`);
    setText('sr-result-best', this.best ? `내 최고 기록 ${formatTime(this.best.timeCs)} · ${this.best.score.toLocaleString()}P` : '');
    setText('sr-result-rank', '');
    setText('sr-save-status', kind === 'complete' ? '기록 등록 중…' : kind === 'expired' ? '마감 전 등록이 완료된 기록만 집계돼요.' : '1991 한 개를 완성하면 기록이 남아요.');
    $('sr-save-retry').hidden = true;
    $('sr-result-retry').hidden = kind === 'expired';
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
    if (visible()) { setText('sr-save-status', '기록 등록 중…'); $('sr-save-retry').hidden = true; }
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
          setText('sr-save-status', saved.changed ? '기록이 등록됐어요.' : '등록된 내 최고 기록을 유지했어요.');
          setText('sr-result-best', saved.changed ? '🏅 내 최고 기록 경신!' : `내 최고 기록 ${formatTime(saved.best.timeCs)} · ${saved.best.score.toLocaleString()}P`);
          this.myRank(saved.best).then(rank => {
            if (visible()) setText('sr-result-rank', `내 최고 기록 · 이벤트 ${rank}위`);
          }).catch(() => { /* A saved result stays saved even if rank loading fails. */ });
        }
        if (this.hooks.getRankingMode() === 'event') this.loadRankingPanel();
      } catch (error) {
        console.warn('[스피드런] 기록 등록 실패:', error);
        if (visible()) {
          setText('sr-save-status', '기록을 등록하지 못했어요. 마감 전에 다시 시도해주세요.');
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
    setText('sr-prepare-status', this.readPending() ? '아직 등록하지 못했어요. 연결과 이벤트 기간을 확인해주세요.' : '대기 기록을 확인했어요.');
  }

  syncStats() {
    const state = this.hooks.getState();
    setText('sr-best', this.best ? formatTime(this.best.timeCs) : '첫 기록에 도전!');
    setText('sr-best-points', this.best ? `완성 점수 ${this.best.score.toLocaleString()}P` : '1991 한 개가 목표예요.');
    setText('sr-score', `${state.score.toLocaleString()}P`);
    const bestGroup = $('mob-best')?.closest('.mob-score-group');
    const wmGroup = $('mob-wm')?.closest('.mob-score-group');
    if (wmGroup) wmGroup.classList.toggle('sr-hide-stat', this.isEventMode());
    if (bestGroup) {
      const label = bestGroup.querySelector('.mob-label');
      if (this.originalMobileLabel === null && label) this.originalMobileLabel = label.textContent;
      if (label) label.textContent = this.isEventMode() ? '내 최고 시간' : this.originalMobileLabel;
    }
    if (this.isEventMode()) setText('mob-best', this.best ? formatTime(this.best.timeCs) : '첫 도전');
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
      const html = '<p class="sr-rank-caption">완성 시간순 · 동시간은 점수순</p>'
        + (rows.length ? rows.map(row => this.rankingRow(row)).join('') : '<p class="sr-rank-empty">첫 1991 완성 기록을 기다리고 있어요!</p>')
        + (own ? `<div class="rank-divider"></div>${this.rankingRow(own)}` : '');
      ids.forEach(id => { $(id).innerHTML = html; });
      this.paintRankingButton(rows[0]);
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('[스피드런] 랭킹 조회 실패:', error);
      ids.forEach(id => { $(id).innerHTML = '<p class="sr-rank-empty">기록을 불러오지 못했어요.<br>EVENT 탭을 다시 눌러주세요.</p>'; });
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
    this.closeDialog('sr-guide'); this.closeDialog('sr-result');
    this.hooks.selectRanking('event'); this.hooks.showFullRanking();
  }

  requestRestart() {
    if (['running', 'countdown'].includes(this.phase)) {
      this.askConfirmation('새로 도전할까요?', '새로 도전', () => this.beginAttempt());
    } else this.beginAttempt();
  }
  requestNormal() {
    if (['running', 'countdown'].includes(this.phase)) {
      this.askConfirmation('도전을 그만둘까요?', '일반 게임으로', () => this.returnNormal());
    } else this.returnNormal();
  }
  askConfirmation(title, actionLabel, action) {
    setText('sr-confirm-title', title); setText('sr-confirm-yes', actionLabel);
    this.confirmAction = action; this.hooks.hideOverlays(); this.showDialog('sr-confirm');
  }
  returnNormal() {
    this.operation++; this.clock.stop(); this.mode = 'normal'; this.phase = 'idle';
    this.closeAllDialogs(); $('sr-countdown').hidden = true;
    document.body.classList.remove('speedrun-mode');
    this.hooks.resetBoard(); this.syncStats(); this.paintBanner();
    this.hooks.selectRanking('today');
  }
  showDialog(id) { const el = $(id); if (!el.open) el.showModal(); }
  closeDialog(id) { const el = $(id); if (el.open) el.close(); }
  closeAllDialogs() { ['sr-guide', 'sr-result', 'sr-confirm'].forEach(id => this.closeDialog(id)); }
  notice(message) {
    setText('sr-toast', message); $('sr-toast').hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { $('sr-toast').hidden = true; }, 4000);
  }
}
