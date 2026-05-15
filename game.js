/**
 * 큐플 합치기 — game.js
 * 수정 내역:
 * 1. UI: 큐플레이 스타일 밝은 테마
 * 2. 진화의 고리: 서클 배치
 * 3. 가이드 세로선 제거
 * 4. 합체 버그 수정 (collisionActive + 근접 감지)
 * 5. 첫 공 항상 1단계
 * 6. 랭킹: 빈 슬롯 10개 표시
 * 7. 효과음 추가 (Web Audio API)
 */

// ====================================================
// Firebase imports
// ====================================================
import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc,
         collection, query, orderBy, limit,
         getDocs, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ====================================================
// [A] FIREBASE CONFIG — 여기에 입력하세요
// apiKey가 비어 있으면 Firebase 비활성화됩니다.
// ====================================================
const FIREBASE_CONFIG = {
  apiKey:            "",
  authDomain:        "",
  projectId:         "",
  storageBucket:     "",
  messagingSenderId: "",
  appId:             ""
};

// ====================================================
// [B] 게임 상수 (여기서 수정)
// ====================================================
const BOARD_WIDTH  = 544;
const BOARD_HEIGHT = 708;
const DANGER_Y     = 115;  // 게임오버 판정 Y
const DROP_Y       = 80;   // 공 시작 Y
const DROP_COOLDOWN = 550; // 드롭 후 쿨다운 ms

// 이미지 URL (여기서 수정)
const BALL_IMAGES = [
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika1.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika2.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika3.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika4.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika5.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika6.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika7.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika8.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika9.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika10.png',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika11.png',
];

// 단계별 반지름 (여기서 수정)
const BALL_RADII = [20, 26, 34, 44, 56, 70, 86, 104, 126, 148, 172];

// 합체 점수 (새로 생성된 단계 기준, 여기서 수정)
const MERGE_SCORES = [0, 2, 6, 15, 36, 78, 160, 325, 660, 1350, 2800];

// 드롭 확률 [단계, 누적확률]
const DROP_WEIGHTS = [
  [1, 0.20],
  [2, 0.40],
  [3, 0.60],
  [4, 0.80],
  [5, 1.00],
];

// localStorage 키
const LS = {
  NICKNAME:        'qplay_suika_nickname',
  PLAYER_ID:       'qplay_suika_player_id',
  BEST_SCORE:      'qplay_suika_best_score',
  BEST_WATERMELON: 'qplay_suika_best_watermelon_count',
};

// 폴백 색상 (이미지 실패 시)
const FALLBACK_COLORS = [
  '#5bc0eb','#2299dd','#44bb99','#f5a623','#e85d4a',
  '#9b59b6','#f97316','#22c55e','#0ea5e9','#8b5cf6','#dc2626'
];

// ====================================================
// Firebase 초기화
// ====================================================
let db = null;
let firebaseEnabled = false;

function initFirebase() {
  try {
    if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.apiKey.trim()) {
      console.warn('[큐플] Firebase config 없음 → 로컬 모드');
      showEmptyRanking();
      return;
    }
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    firebaseEnabled = true;
  } catch (e) {
    console.warn('[큐플] Firebase 초기화 실패:', e);
    showEmptyRanking();
  }
}

// ====================================================
// localStorage 헬퍼
// ====================================================
function lsGet(key, fb = '') {
  try { return localStorage.getItem(key) ?? fb; } catch { return fb; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, String(val)); } catch {}
}
function lsGetInt(key, fb = 0) {
  const n = parseInt(lsGet(key, String(fb)), 10);
  return isNaN(n) ? fb : n;
}

// ====================================================
// 게임 상태
// ====================================================
let score = 0, bestScore = 0;
let watermelonCount = 0, bestWatermelonCount = 0;
let nickname = '', playerId = '';
let gameOver = false, canDrop = true;
let currentLv = 1, nextLv = 1;
let dropX = BOARD_WIDTH / 2;

let activeBodies = [];
let mergeQueue   = new Set(); // uid쌍 → 중복 합체 방지
let dangerTimers = new Map();
let mergeEffects = [];
let ballIdCnt    = 0;

// ====================================================
// [1] 효과음 (Web Audio API)
// ====================================================
let audioCtx = null;

function getAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

// 드롭 효과음: 가볍고 부드러운 "뚝"
function playDropSound() {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

// 합체 효과음: 경쾌한 3음 상승
function playMergeSound(level) {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    // 레벨이 높을수록 더 높고 밝은 소리
    const base = 440 * Math.pow(1.06, level);
    const freqs = [base, base * 1.25, base * 1.5];
    freqs.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.07;
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.35);
    });
    // 수박 완성 시 특별 사운드
    if (level === 11) {
      setTimeout(() => {
        const fanfare = [523, 659, 784, 1047];
        fanfare.forEach((freq, i) => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = ctx.currentTime + i * 0.1;
          gain.gain.setValueAtTime(0.2, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          osc.start(t);
          osc.stop(t + 0.4);
        });
      }, 100);
    }
  } catch (e) {}
}

// ====================================================
// 이미지 로드
// ====================================================
const imgs = new Array(11).fill(null);

function loadImages() {
  return Promise.all(
    BALL_IMAGES.map((url, i) =>
      new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { imgs[i] = img; resolve(); };
        img.onerror = () => { imgs[i] = null; resolve(); };
        img.src = url;
      })
    )
  );
}

// ====================================================
// Matter.js 설정
// ====================================================
const { Engine, Bodies, Body, World, Events, Composite } = Matter;
let engine, world;

function initPhysics() {
  engine = Engine.create();
  world  = engine.world;
  engine.gravity.y = 1.5;

  const opt = { isStatic: true, friction: 1, restitution: 0, label: 'wall' };
World.add(world, [
  Bodies.rectangle(BOARD_WIDTH / 2, BOARD_HEIGHT + 25, BOARD_WIDTH + 100, 50, opt),
  Bodies.rectangle(-25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),
  Bodies.rectangle(BOARD_WIDTH + 25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),
]);

  // [4] 합체 버그 수정: collisionStart + collisionActive 둘 다 사용
  Events.on(engine, 'collisionStart',  onCollision);
  Events.on(engine, 'collisionActive', onCollision);
}

function clearAllBalls() {
  activeBodies.forEach(b => World.remove(world, b));
  activeBodies = [];
  mergeQueue.clear();
  dangerTimers.clear();
}

// ====================================================
// 랜덤 단계 생성
// ====================================================
function randomDropLevel() {
  const r = Math.random();
  for (const [lv, cp] of DROP_WEIGHTS) {
    if (r < cp) return lv;
  }
  return 1;
}

// ====================================================
// 공 생성
// ====================================================
function createBall(x, y, level, fromMerge = false) {
  const radius = BALL_RADII[level - 1];
  const body = Bodies.circle(x, y, radius, {
  restitution:    0,
  friction:       1,
  frictionAir:    0.003,
  frictionStatic: 0.5,
  density:        0.001 + level * 0.0002,
  label:          'ball',
  slop:           0.05,
});

  ballIdCnt++;
  body.gameData = {
  level,
  uid:       ballIdCnt,
  isMerging: false,
  spawnTime: Date.now(),
  popScale:  1.0,
};

  World.add(world, body);
  activeBodies.push(body);
  return body;
}

// ====================================================
// 공 드롭
// ====================================================
function dropBall() {
  if (gameOver || !canDrop) return;
  canDrop = false;

  const lv     = currentLv;
  const radius = BALL_RADII[lv - 1];
  const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));

  createBall(safeX, DROP_Y, lv, false);
  playDropSound(); // [7] 드롭 효과음

  currentLv = nextLv;
  nextLv    = randomDropLevel();
  updateNextPreview();
  buildEvoRing(currentLv); // 진화의 고리 갱신

  setTimeout(() => { canDrop = true; }, DROP_COOLDOWN);
}

// ====================================================
// [4] 합체 감지 (collisionStart + collisionActive)
// ====================================================
function onCollision(event) {
  if (gameOver) return;
  event.pairs.forEach(pair => processMergePair(pair.bodyA, pair.bodyB));
}

function processMergePair(a, b) {
  if (a.label !== 'ball' || b.label !== 'ball') return;
  if (!a.gameData || !b.gameData) return;
  if (a.gameData.isMerging || b.gameData.isMerging) return;

  const lvA = a.gameData.level;
  const lvB = b.gameData.level;
  if (lvA !== lvB || lvA >= 11) return;

  const uidA = a.gameData.uid;
  const uidB = b.gameData.uid;
  const key  = uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
  if (mergeQueue.has(key)) return;

  mergeQueue.add(key);

  a.gameData.isMerging = true;
  b.gameData.isMerging = true;

  mergeBalls(a, b, lvA);
  mergeQueue.delete(key);
}

// ====================================================
// [4-보조] 게임루프에서 근접 공 검사 (floor 위 밀착 케이스 대응)
// ====================================================
let proximityCheckFrame = 0;

function checkProximityMerges() {
  proximityCheckFrame++;
  if (gameOver) return;

  const len = activeBodies.length;

  for (let i = 0; i < len; i++) {
    const a = activeBodies[i];
    if (!a || !a.gameData || a.gameData.isMerging) continue;

    for (let j = i + 1; j < len; j++) {
      const b = activeBodies[j];
      if (!b || !b.gameData || b.gameData.isMerging) continue;

      const lvA = a.gameData.level;
      const lvB = b.gameData.level;
      if (lvA !== lvB || lvA >= 11) continue;

      // 거리 계산
      const dx   = a.position.x - b.position.x;
      const dy   = a.position.y - b.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = BALL_RADII[lvA - 1] + BALL_RADII[lvB - 1];

      // 닿거나 약간 겹치면 합체 (tolerance 3px)
      if (dist <= minD + 8) {
  processMergePair(a, b);
}
    }
  }
}

// ====================================================
// 공 합체
// ====================================================
function mergeBalls(a, b, level) {
  if (!activeBodies.includes(a) || !activeBodies.includes(b)) return;

  const mx = (a.position.x + b.position.x) / 2;
  const my = (a.position.y + b.position.y) / 2;

  activeBodies = activeBodies.filter(bd => bd !== a && bd !== b);
  dangerTimers.delete(a.gameData.uid);
  dangerTimers.delete(b.gameData.uid);
  World.remove(world, a);
  World.remove(world, b);

  const newLevel    = level + 1;
  const isWatermelon = newLevel === 11;

  score += MERGE_SCORES[newLevel - 1];
  if (score > bestScore) bestScore = score;

  if (isWatermelon) {
    watermelonCount++;
    if (watermelonCount > bestWatermelonCount) bestWatermelonCount = watermelonCount;
  }

  playMergeSound(newLevel); // [7] 합체 효과음
  addMergeEffect(mx, my, newLevel, isWatermelon);
  createBall(mx, my, newLevel, true);
  updateScoreUI();
}

// ====================================================
// 시각 효과
// ====================================================
function addMergeEffect(x, y, level, isWatermelon) {
  mergeEffects.push({
    x, y, level, isWatermelon,
    startTime: Date.now(),
    duration:  isWatermelon ? 900 : 380,
  });
}

// ====================================================
// 캔버스 렌더링
// ====================================================
let canvas, ctx;

function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');
  canvas.width  = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap || !canvas) return;
  const dw = Math.min(BOARD_WIDTH, wrap.clientWidth);
  canvas.style.width  = dw + 'px';
  canvas.style.height = (BOARD_HEIGHT * dw / BOARD_WIDTH) + 'px';
}

function toGameX(clientX) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = BOARD_WIDTH / rect.width;
  return (clientX - rect.left) * scaleX;
}

function renderFrame() {
  // [1] 배경: 밝은 하늘색
  ctx.fillStyle = '#d6eeff';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  // 게임오버 라인
  ctx.save();
  ctx.strokeStyle = 'rgba(229, 57, 53, 0.6)';
  ctx.lineWidth   = 2;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.moveTo(0, DANGER_Y);
  ctx.lineTo(BOARD_WIDTH, DANGER_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font      = '11px sans-serif';
  ctx.fillStyle = 'rgba(229,57,53,0.6)';
  ctx.fillText('DANGER', 6, DANGER_Y - 5);
  ctx.restore();

  // 합체 파동 효과
  const now = Date.now();
  mergeEffects = mergeEffects.filter(eff => {
    const t = (now - eff.startTime) / eff.duration;
    if (t >= 1) return false;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.85;
    const r = BALL_RADII[eff.level - 1];
    if (eff.isWatermelon) {
      ctx.strokeStyle = '#f5a623';
      ctx.lineWidth   = 5;
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, t * 110, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f5811f';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, t * 70, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#1a88cc';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, t * (r + 28), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return true;
  });

  // 공 렌더링
  Composite.allBodies(world).forEach(body => {
    if (body.label !== 'ball' || !body.gameData) return;

    const { level, popScale } = body.gameData;
    const radius = BALL_RADII[level - 1];
    const img    = imgs[level - 1];
    const { x, y } = body.position;

    if (popScale < 1) body.gameData.popScale = Math.min(1, popScale + 0.15);
    const scale = body.gameData.popScale;

    ctx.save();
ctx.translate(x, y);
ctx.rotate(body.angle);
ctx.scale(scale, scale);
ctx.beginPath();
ctx.arc(0, 0, radius, 0, Math.PI * 2);
ctx.closePath();
ctx.clip();

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = FALLBACK_COLORS[level - 1];
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font      = `bold ${Math.max(12, radius * 0.5)}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(level, 0, 0);
    }
    ctx.restore();
  });

  // [3] 세로 가이드 라인 제거 → 미리보기 공만 표시 (세로선 없음)
  // [3] 떨어지기 전 대기 공 표시
if (canDrop && !gameOver) {
  const lv     = currentLv;
  const radius = BALL_RADII[lv - 1];
  const img    = imgs[lv - 1];
  const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));

  ctx.save();

  // ★ 절대 흐리지 않게: 완전 불투명
  ctx.globalAlpha = 1;
  ctx.translate(safeX, DROP_Y);
  ctx.rotate(0);
  ctx.scale(1, 1);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = FALLBACK_COLORS[lv - 1];
    ctx.fill();
  }

  ctx.restore();
}

  if (gameOver) {
    ctx.fillStyle = 'rgba(200,230,255,0.4)';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }
}

// ====================================================
// 게임오버 감지
// ====================================================
function checkGameOver() {
  if (gameOver) return;
  const now = Date.now();

  for (const body of activeBodies) {
    if (!body.gameData || body.gameData.isMerging) continue;
    const level  = body.gameData.level;
    const radius = BALL_RADII[level - 1];
    const age    = now - body.gameData.spawnTime;
    if (age < 1500) continue;

    const topY = body.position.y - radius;
    const vx   = Math.abs(body.velocity.x);
    const vy   = Math.abs(body.velocity.y);

    if (topY < DANGER_Y && vx < 1.0 && vy < 1.0) {
      const uid = body.gameData.uid;
      if (!dangerTimers.has(uid)) {
        dangerTimers.set(uid, now);
      } else if (now - dangerTimers.get(uid) > 2000) {
        endGame();
        return;
      }
    } else {
      dangerTimers.delete(body.gameData.uid);
    }
  }
}

// ====================================================
// 게임 종료
// ====================================================
async function endGame() {
  if (gameOver) return;
  gameOver = true;

  // 게임판 덜덜 진동
  const wrap = document.getElementById('canvas-wrap');
  if (wrap) {
    wrap.classList.remove('shake-hard');
    void wrap.offsetWidth; // 애니메이션 재시작용
    wrap.classList.add('shake-hard');

    setTimeout(() => {
  wrap.classList.remove('shake-hard');
}, 2100);
  }

  const prevBest = lsGetInt(LS.BEST_SCORE, 0);
  const prevBestWm = lsGetInt(LS.BEST_WATERMELON, 0);
  let scoreUpdated = false, wmUpdated = false;

  if (score > prevBest) {
    lsSet(LS.BEST_SCORE, score);
    bestScore = score;
    scoreUpdated = true;
  }

  if (watermelonCount > prevBestWm) {
    lsSet(LS.BEST_WATERMELON, watermelonCount);
    bestWatermelonCount = watermelonCount;
    wmUpdated = true;
  }

  updateScoreUI();

  // 진동을 먼저 보여준 뒤 게임오버 모달 표시
  setTimeout(() => {
    showGameoverModal(scoreUpdated, wmUpdated);
  }, 2000);

  if (firebaseEnabled && nickname && (scoreUpdated || wmUpdated)) {
    await saveToFirebase();
  }
}

// ====================================================
// 재시작
// ====================================================
function restartGame() {
  gameOver = false; canDrop = true;
  score = 0; watermelonCount = 0;
  mergeEffects = [];
  clearAllBalls();
  hideGameoverModal();

  // [5] 재시작 후 첫 공은 항상 1단계
  currentLv = 1;
  nextLv    = randomDropLevel();
  dropX     = BOARD_WIDTH / 2;

  updateScoreUI();
  updateNextPreview();
  buildEvoRing(currentLv);
}

// ====================================================
// 메인 게임 루프
// ====================================================
function gameLoop() {
  if (!gameOver) {
    Engine.update(engine, 1000 / 60);
    checkGameOver();
    checkProximityMerges(); // [4] 근접 합체 보조 감지
  }
  renderFrame();
  requestAnimationFrame(gameLoop);
}

// ====================================================
// Firebase 저장
// ====================================================
async function saveToFirebase() {
  if (!firebaseEnabled || !db) return;
  try {
    const docRef   = doc(db, 'scores', playerId);
    const existing = await getDoc(docRef);
    let fs = score, fwm = watermelonCount;
    if (existing.exists()) {
      const d = existing.data();
      fs  = Math.max(score, d.score || 0);
      fwm = Math.max(watermelonCount, d.watermelonCount || 0);
    }
    await setDoc(docRef, {
      playerId, nickname,
      score: fs, watermelonCount: fwm,
      updatedAt: serverTimestamp(),
    });
    await loadRanking();
  } catch (e) { console.warn('[큐플] Firebase 저장 실패:', e); }
}

// ====================================================
// Firebase 랭킹
// ====================================================
async function loadRanking() {
  if (!firebaseEnabled || !db) { showEmptyRanking(); return; }
  try {
    const q    = query(collection(db, 'scores'), orderBy('score', 'desc'), limit(10));
    const snap = await getDocs(q);
    if (snap.empty) { showEmptyRanking(); return; }
    const data = [];
    snap.forEach(d => data.push(d.data()));
    data.sort((a, b) => b.score - a.score || b.watermelonCount - a.watermelonCount);
    renderRanking(data);
  } catch (e) {
    console.warn('[큐플] 랭킹 불러오기 실패:', e);
    showEmptyRanking();
  }
}

// [6] 빈 랭킹 슬롯 10개 표시
function showEmptyRanking() {
  const rows = Array.from({ length: 10 }, (_, i) => `
    <div class="rank-row">
      <span class="rank-num">${i + 1}</span>
      <span class="rank-nick empty">-</span>
      <span class="rank-score">-</span>
      <span class="rank-wm">-</span>
    </div>
  `).join('');
  document.getElementById('ranking-list').innerHTML          = rows;
  document.getElementById('mobile-ranking-list').innerHTML   = rows;
}

function renderRanking(data) {
  // 10칸 유지: 데이터 있으면 채우고 나머지는 빈칸
  const rows = Array.from({ length: 10 }, (_, i) => {
    const item = data[i];
    if (item) {
      return `
        <div class="rank-row ${item.playerId === playerId ? 'my-rank' : ''}">
          <span class="rank-num">${i + 1}</span>
          <span class="rank-nick">${escHtml(item.nickname)}</span>
          <span class="rank-score">${(item.score||0).toLocaleString()}P</span>
          <span class="rank-wm">🍉${item.watermelonCount||0}</span>
        </div>`;
    } else {
      return `
        <div class="rank-row">
          <span class="rank-num">${i + 1}</span>
          <span class="rank-nick empty">-</span>
          <span class="rank-score">-</span>
          <span class="rank-wm">-</span>
        </div>`;
    }
  }).join('');

  document.getElementById('ranking-list').innerHTML        = rows;
  document.getElementById('mobile-ranking-list').innerHTML = rows;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ====================================================
// [2] 진화의 고리 (서클 배치)
// ====================================================
function buildEvoRing(activeLevel = 0) {
  const ring = document.getElementById('evolution-ring');
  if (!ring) return;
  ring.innerHTML = '';
  const cx = 83, cy = 83, r = 65;

  BALL_IMAGES.forEach((url, i) => {
    const level = i + 1;
    const angle = -90 + i * (360 / 11);
    const rad   = angle * Math.PI / 180;

    const div = document.createElement('div');
    div.className = 'ring-item' + (level === activeLevel ? ' active' : '');
    div.style.left = (cx + Math.cos(rad) * r) + 'px';
    div.style.top  = (cy + Math.sin(rad) * r) + 'px';

    const img = document.createElement('img');
    img.src = url;
    img.alt = level + '단계';
    div.appendChild(img);
    ring.appendChild(div);
  });
}

// ====================================================
// UI 갱신
// ====================================================
function updateScoreUI() {
  const bs  = Math.max(score, lsGetInt(LS.BEST_SCORE, 0));
  const bwm = Math.max(watermelonCount, lsGetInt(LS.BEST_WATERMELON, 0));

  setText('score-display',   score.toLocaleString());
  setText('best-display',    bs.toLocaleString());
  setText('wm-display',      watermelonCount + '개');
  setText('best-wm-display', bwm + '개');
  setText('mob-score',       score.toLocaleString());
  setText('mob-best',        bs.toLocaleString());
  setText('mob-wm',          watermelonCount);
  setText('mob-rank-best',   bs.toLocaleString());
}

function updateNextPreview() {
  const src = imgs[nextLv - 1]?.src || BALL_IMAGES[nextLv - 1];
  setImg('next-ball-img', src);
  setImg('mob-next-img',  src);
}

function updatePlayerDisplay() {
  setText('player-display', `플레이어: ${nickname}`);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setImg(id, src)  { const el = document.getElementById(id); if (el) el.src = src; }

// ====================================================
// 게임오버 모달
// ====================================================
function showGameoverModal(scoreUpdated, wmUpdated) {
  const bs  = Math.max(score, lsGetInt(LS.BEST_SCORE, 0));
  const bwm = Math.max(watermelonCount, lsGetInt(LS.BEST_WATERMELON, 0));

  setText('go-player',  `플레이어: ${nickname}`);
  setText('go-score',   score.toLocaleString() + 'P');
  setText('go-best',    bs.toLocaleString() + 'P');
  setText('go-wm',      watermelonCount + '개');
  setText('go-best-wm', bwm + '개');

  let msg = '아쉽지만 최고 기록에는 도달하지 못했어요.';
  if (scoreUpdated)   msg = '🎉 최고 기록 갱신! 랭킹에 반영됐어요.';
  else if (wmUpdated) msg = '🍉 수박 기록 갱신! 더 많은 수박을 만들었어요.';
  setText('go-message', msg);

  document.getElementById('gameover-modal').classList.remove('hidden');
}
function hideGameoverModal() { document.getElementById('gameover-modal').classList.add('hidden'); }

// ====================================================
// 닉네임 모달
// ====================================================
function showNicknameModal() {
  document.getElementById('nickname-modal').classList.remove('hidden');
  const inp = document.getElementById('nickname-input');
  inp.value = nickname || '';
  document.getElementById('nickname-error').textContent = '';
  setTimeout(() => inp.focus(), 100);
}
function hideNicknameModal() { document.getElementById('nickname-modal').classList.add('hidden'); }

function confirmNickname() {
  const input = document.getElementById('nickname-input').value.trim();
  const errEl = document.getElementById('nickname-error');
  if (input.length < 2 || input.length > 10) {
    errEl.textContent = '닉네임은 2~10글자여야 해요.';
    return;
  }
  nickname = input;
  lsSet(LS.NICKNAME, nickname);
  updatePlayerDisplay();
  hideNicknameModal();
}

// ====================================================
// 입력 처리
// ====================================================
function initInput() {
  canvas.addEventListener('mousemove', e => {
    if (gameOver) return;
    dropX = toGameX(e.clientX);
  });

  canvas.addEventListener('click', () => {
    if (gameOver || !canDrop) return;
    dropBall();
  });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (gameOver) return;
    dropX = toGameX(e.touches[0].clientX);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (gameOver) return;
    dropX = toGameX(e.touches[0].clientX);
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (gameOver || !canDrop) return;
    dropBall();
  }, { passive: false });
}

// ====================================================
// 초기화
// ====================================================
async function init() {
  nickname  = lsGet(LS.NICKNAME, '');
  playerId  = lsGet(LS.PLAYER_ID, '');
  bestScore = lsGetInt(LS.BEST_SCORE, 0);
  bestWatermelonCount = lsGetInt(LS.BEST_WATERMELON, 0);

  if (!playerId) {
    playerId = crypto.randomUUID();
    lsSet(LS.PLAYER_ID, playerId);
  }

  initFirebase();
  await loadImages();
  initCanvas();
  initPhysics();
  initInput();

  // 버튼 바인딩
  bind('nickname-confirm-btn', 'click', confirmNickname);
  bind('nickname-input', 'keydown', e => { if (e.key === 'Enter') confirmNickname(); });
  bind('change-nickname-btn', 'click', showNicknameModal);
  bind('mob-change-nick-btn', 'click', showNicknameModal);
  bind('restart-btn',         'click', restartGame);
  bind('mob-restart-btn',     'click', restartGame);
  bind('go-restart-btn',  'click', () => { hideGameoverModal(); restartGame(); });
  bind('go-ranking-btn',  'click', () => { hideGameoverModal(); showMobileRanking(); });
  bind('go-nickname-btn', 'click', () => { hideGameoverModal(); showNicknameModal(); });
  bind('mob-ranking-btn',   'click', showMobileRanking);
  bind('mob-ranking-close', 'click', hideMobileRanking);

  // 닉네임 없으면 모달
  if (!nickname) { showNicknameModal(); }
  else { updatePlayerDisplay(); }

  // [5] 첫 공은 무조건 1단계
  currentLv = 1;
  nextLv    = randomDropLevel();

  updateScoreUI();
  updateNextPreview();
  buildEvoRing(currentLv);
  showEmptyRanking();
  loadRanking();

  requestAnimationFrame(gameLoop);
}

function bind(id, ev, fn) { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }
function showMobileRanking() { document.getElementById('mobile-ranking-panel').classList.remove('hidden'); }
function hideMobileRanking() { document.getElementById('mobile-ranking-panel').classList.add('hidden'); }

init();
