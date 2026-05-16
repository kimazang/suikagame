/**
 * 큐플 합치기 — game.js
 * 레퍼런스(playsuikagame.com) 기준 수정 내역:
 * 1. 점수 체계: 삼각수 공식 [1,3,6,10,15,21,28,36,45,55,66]
 * 2. 사망 조건: 충돌 시 공 상단 68px 미만이면 즉시 게임오버
 * 3. 드롭 확률: 1~5단계 균등 랜덤 (가중치 제거)
 * 4. 쿨다운: 600ms
 * 5. 물리: frictionAir/frictionStatic/density/slop 제거 (레퍼런스와 동일)
 * 6. DROP_Y: 80px (레퍼런스 원본)
 * 7. 첫 공: 1단계 고정 (레퍼런스 동일, fruit0 고정)
 * 8. 합체 위치: bodyA 기준 (중점 → A위치)
 * 9. 게임오버 모달: shake 완료(900ms) 후 표시
 * 10. 합체 시 팝 애니메이션: popScale 0.3에서 시작
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
  apiKey: "AIzaSyDIdgkLu5IssN4tvSzRO3d-XFxU2Q4AmU4",
  authDomain: "qplay-suika-game.firebaseapp.com",
  projectId: "qplay-suika-game",
  storageBucket: "qplay-suika-game.firebasestorage.app",
  messagingSenderId: "37069901682",
  appId: "1:37069901682:web:9a17bec050c9102af797eb"
};

// ====================================================
// [B] 게임 상수 (여기서 수정)
// ====================================================
const BOARD_WIDTH  = 544;
const BOARD_HEIGHT = 612; // 박스 이미지(579x652) 비율 유지
const BOX_LEFT   = 49;   // 클리핑용
const BOX_RIGHT  = 494;  // 클리핑용
const BOX_BOTTOM = 548;  // 클리핑용 (바닥)
const DANGER_Y   = 51;   // 게임오버 판정 Y (박스 상단 안쪽 선)
const DROP_Y     = 28;   // 공 시작 Y
const DROP_COOLDOWN = 600;

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
const BALL_RADII = [19, 25, 33, 43, 55, 69, 85, 103, 123, 145, 168];

// 합체 점수 (레퍼런스 원본: 삼각수 n*(n+1)/2)
// fruit0→+1, fruit1→+3, fruit2→+6, fruit3→+10, fruit4→+15,
// fruit5→+21, fruit6→+28, fruit7→+36, fruit8→+45, fruit9→+55, fruit10→+66
const MERGE_SCORES = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];

// 드롭 확률: 레퍼런스 원본과 동일하게 1~5단계 균등 확률
// (레퍼런스: Math.floor(Math.random() * 5) → fruit0~fruit4)

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
let boxImg = null;

function loadImages() {
  const ballPromises = BALL_IMAGES.map((url, i) =>
    new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { imgs[i] = img; resolve(); };
      img.onerror = () => { imgs[i] = null; resolve(); };
      img.src = url;
    })
  );
  const boxPromise = new Promise(resolve => {
    boxImg = new Image();
    boxImg.crossOrigin = 'anonymous';
    boxImg.onload  = () => resolve();
    boxImg.onerror = () => resolve();
    boxImg.src = 'https://raw.githubusercontent.com/kimazang/suikagame/main/box.png';
  });
  return Promise.all([...ballPromises, boxPromise]);
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
    // 바닥 — 박스 안쪽 바닥
    Bodies.rectangle(BOARD_WIDTH / 2, BOX_BOTTOM + 25, BOARD_WIDTH, 50, opt),
    // 왼쪽 벽 — 박스 안쪽 왼쪽 면
    Bodies.rectangle(BOX_LEFT - 25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),
    // 오른쪽 벽 — 박스 안쪽 오른쪽 면
    Bodies.rectangle(BOX_RIGHT + 25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),
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
// 랜덤 단계 생성 (레퍼런스: 1~5단계 균등 확률)
// ====================================================
function randomDropLevel() {
  return Math.floor(Math.random() * 5) + 1;
}

// ====================================================
// 공 생성
// ====================================================
function createBall(x, y, level, fromMerge = false) {
  const radius = BALL_RADII[level - 1];
  const body = Bodies.circle(x, y, radius, {
    restitution: 0,       // setBounce(0)
    friction:    1,       // setFriction(1)
    label:       'ball',
    // frictionAir, frictionStatic, density, slop → 레퍼런스에 없으므로 제거 (Matter.js 기본값 사용)
  });

  ballIdCnt++;
  body.gameData = {
    level,
    uid:       ballIdCnt,
    isMerging: false,
    spawnTime: Date.now(),
    popScale:  fromMerge ? 0.3 : 1.0, // 합체 시 팝 애니메이션
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
  event.pairs.forEach(pair => {
    // 사망 판정: 레퍼런스 원본과 동일
    // 충돌하는 두 공 중 하나라도 상단이 DANGER_Y(70px) 위에 있으면 즉시 게임오버
    checkDangerCollision(pair.bodyA, pair.bodyB);
    // 합체 판정
    processMergePair(pair.bodyA, pair.bodyB);
  });
}

// 레퍼런스 사망 조건:
// 충돌 시 bodyA 또는 bodyB의 중심Y가 70 미만이면 game_over
// (방금 생성된 공은 제외 — spawnTime 1초 이내)
function checkDangerCollision(a, b) {
  if (gameOver) return;
  if (a.label !== 'ball' || b.label !== 'ball') return;
  if (!a.gameData || !b.gameData) return;

  const now = Date.now();
  // 방금 생성된 공(1초 이내)은 판정 제외
  if (now - a.gameData.spawnTime < 1000) return;
  if (now - b.gameData.spawnTime < 1000) return;

  const GAME_OVER_Y = DANGER_Y;
  const topA = a.position.y - BALL_RADII[a.gameData.level - 1];
  const topB = b.position.y - BALL_RADII[b.gameData.level - 1];

  if (topA < GAME_OVER_Y || topB < GAME_OVER_Y) {
    endGame();
  }
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
      if (dist <= minD + 4) {
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

  // 레퍼런스: bodyA 위치 기준으로 새 공 생성 (중점 아님)
  const mx = a.position.x;
  const my = a.position.y;

  activeBodies = activeBodies.filter(bd => bd !== a && bd !== b);
  dangerTimers.delete(a.gameData.uid);
  dangerTimers.delete(b.gameData.uid);
  World.remove(world, a);
  World.remove(world, b);

  const newLevel    = level + 1;
  const isWatermelon = newLevel === 11;

  // 레퍼런스: updateScore(합체 전 공의 key) 기준
  // fruit0+fruit0 → level=1 → MERGE_SCORES[0] = +1
  // fruit9+fruit9 → level=10 → MERGE_SCORES[9] = +55
  score += MERGE_SCORES[level - 1];
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
  // [1] 박스 이미지를 배경으로 먼저 그리기
  if (boxImg && boxImg.complete && boxImg.naturalWidth > 0) {
    ctx.drawImage(boxImg, 0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  } else {
    // 박스 이미지 없으면 크림색 배경
    ctx.fillStyle = '#fff9ee';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }

  // [2] DANGER 경고선 (박스 상단 안쪽 선 위치)
  ctx.save();
  ctx.strokeStyle = 'rgba(229, 57, 53, 0.6)';
  ctx.lineWidth   = 2;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.moveTo(BOX_LEFT, DANGER_Y);
  ctx.lineTo(BOX_RIGHT, DANGER_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font      = 'bold 11px sans-serif';
  ctx.fillStyle = 'rgba(229,57,53,0.6)';
  ctx.fillText('DANGER', BOX_LEFT + 6, DANGER_Y - 4);
  ctx.restore();

  // [3] 합체 파동 효과
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

  // [4] 공 렌더링
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

  // [5] 박스 이미지를 다시 위에 덮기 — 테두리가 공 위에 보이게
  if (boxImg && boxImg.complete && boxImg.naturalWidth > 0) {
    // 테두리 부분만 덮기 위해 안쪽 클리핑 제외
    ctx.save();
    // 안쪽 플레이 영역을 구멍 뚫어서 테두리만 그리기
    ctx.beginPath();
    // 전체 캔버스
    ctx.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    // 안쪽 플레이 영역 (역방향 = 구멍)
    ctx.rect(BOX_LEFT, DANGER_Y, BOX_RIGHT - BOX_LEFT, BOX_BOTTOM - DANGER_Y);
    ctx.clip('evenodd');
    ctx.drawImage(boxImg, 0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }

  // [6] 대기 공 표시 (박스 위에서 대기)
  if (canDrop && !gameOver) {
    const lv     = currentLv;
    const radius = BALL_RADII[lv - 1];
    const img    = imgs[lv - 1];
    const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(safeX, DROP_Y);
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
    ctx.fillStyle = 'rgba(255,249,238,0.5)';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }
}

// ── 모서리 둥근 사각형 헬퍼 ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ====================================================
// 게임오버 감지
// 레퍼런스 방식: 충돌 시 즉시 판정 (checkDangerCollision)
// 아래는 안전망 — 공이 정지한 채로 위험선을 넘어있을 때 대비
// ====================================================
function checkGameOver() {
  if (gameOver) return;
  const now = Date.now();

  for (const body of activeBodies) {
    if (!body.gameData || body.gameData.isMerging) continue;
    const age = now - body.gameData.spawnTime;
    if (age < 2000) continue; // 생성 후 2초 이내 제외

    const radius = BALL_RADII[body.gameData.level - 1];
    const topY = body.position.y - radius;
    const vx = Math.abs(body.velocity.x);
    const vy = Math.abs(body.velocity.y);

    // 완전히 정지한 상태로 위험선 위에 있으면 게임오버 (안전망)
    if (topY < DANGER_Y && vx < 0.5 && vy < 0.5) {
      endGame();
      return;
    }
  }
}

// ====================================================
// 게임 종료
// ====================================================
async function endGame() {
  if (gameOver) return;
  gameOver = true;

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) {
    wrap.classList.remove('shake-hard');
    void wrap.offsetWidth;
    wrap.classList.add('shake-hard');
    setTimeout(() => wrap.classList.remove('shake-hard'), 1500);
  }

  const prevBest   = lsGetInt(LS.BEST_SCORE, 0);
  const prevBestWm = lsGetInt(LS.BEST_WATERMELON, 0);
  let scoreUpdated = false;
  let wmUpdated    = false;

  if (score > prevBest) {
    lsSet(LS.BEST_SCORE, score);
    bestScore    = score;
    scoreUpdated = true;
  }
  if (watermelonCount > prevBestWm) {
    lsSet(LS.BEST_WATERMELON, watermelonCount);
    bestWatermelonCount = watermelonCount;
    wmUpdated = true;
  }

  updateScoreUI();

  // 레퍼런스: 카메라 흔들림(800ms) 완료 후 게임오버 화면
  setTimeout(() => {
    showGameoverModal(scoreUpdated, wmUpdated);
  }, 900);

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

  // 레퍼런스 동일: 재시작 후 첫 공도 1단계 고정
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
    const docRef = doc(db, 'scores', playerId);
    const existing = await getDoc(docRef);

    let fs = score;
    let fwm = watermelonCount;

    if (existing.exists()) {
      const d = existing.data();
      fs  = Math.max(score, d.score || 0);
      fwm = Math.max(watermelonCount, d.watermelonCount || 0);
    }

    await setDoc(docRef, {
      playerId,
      nickname,
      score: fs,
      watermelonCount: fwm,
      updatedAt: serverTimestamp(),
    });

    await loadRanking();

  } catch (e) {
    console.warn('[큐플] Firebase 저장 실패:', e);
  }
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
          <span class="rank-wm">🤎${item.watermelonCount||0}</span>
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

  // 레퍼런스 동일: 첫 공은 항상 1단계(fruit0) 고정, 다음 공만 랜덤
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
