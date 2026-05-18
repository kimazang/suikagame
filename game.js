/**
 * 갈뚱 만들기 — game.js
 * - 물리: Matter.js (gravity 2.5, friction 1, restitution 0)
 * - 점수: 레퍼런스 삼각수 기준 [1,3,6,10,15,21,28,36,45,55,66]
 * - 공 크기: 레퍼런스 지름 기준 환산
 * - 드롭: 1~5단계 균등 랜덤, 쿨다운 600ms
 * - 사망: 위험선 위에서 2초 정지
 * - 랭킹: Firebase Firestore, TOP10 + 내 순위 별도 표시
 * - 진화의 고리: PC 원형 / 모바일 가로 나열
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
const BOARD_HEIGHT = 708;
const DANGER_Y     = 68;   // 게임오버 판정 Y
const DROP_Y       = 80;   // 공 시작 Y
const DROP_COOLDOWN = 600; // 드롭 후 쿨다운 ms

// 이미지 URL (여기서 수정)
const BALL_IMAGES = [
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika1.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika2.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika3.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika4.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika5.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika6.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika7.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika8.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika9.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika10.png',
  'https://cdn.jsdelivr.net/gh/kimazang/suikagame@main/suika11.png',
];

// 단계별 반지름 (레퍼런스 기준 지름/2)
// 1:32 2:46 3:60 4:70 5:85 6:110 7:130 8:155 9:180(추정) 10:220 11:260
const BALL_RADII = [16, 23, 30, 35, 42, 55, 65, 78, 90, 110, 130];

// 합체 점수 (새로 생성된 단계 기준, 여기서 수정)
const MERGE_SCORES = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];

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

// 이미지 가장자리 투명 여백 때문에 구슬 사이가 떠 보이는 것을 보정한다.
// 물리 충돌 크기는 그대로 두고, 화면에 그릴 때만 아주 살짝 크게 보여준다.
const BALL_DRAW_SCALE = 1.045;

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

let activeBodies    = [];
let activeBodiesSet = new Set(); // O(1) 존재 확인용
let mergeQueue   = new Set(); // uid쌍 → 중복 합체 방지
let dangerTimers = new Map();
let mergeEffects = [];
let ballIdCnt    = 0;

// ====================================================
// 효과음 (Web Audio API)
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

// 인게임 공 이미지 품질 개선용 프리렌더 스프라이트
// 원본 이미지를 매 프레임 바로 축소/회전해서 그리면 모바일에서 가장자리가 지글지글해 보일 수 있어서,
// 처음 로딩할 때 단계별 크기에 맞춘 고해상도 원형 구슬 이미지를 미리 만들어둔다.
const ballSprites = new Array(11).fill(null);

function createBallSprite(img, level) {
  const radius = BALL_RADII[level - 1];
  const size   = radius * 2;
  const scale  = 4; // 고해상도 프리렌더. 3~4 정도가 품질/성능 균형이 좋음
  const s      = size * scale;

  const off = document.createElement('canvas');
  off.width  = s;
  off.height = s;

  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  // IMPORTANT:
  // 원본 구슬 이미지에 이미 테두리/원형 디자인이 들어가 있으므로,
  // 코드에서 흰색 테두리나 안쪽 패딩을 추가하지 않는다.
  // 예전처럼 pad/clip/stroke를 넣으면 실제 물리 반지름보다 이미지가 작아 보여
  // 구슬끼리 닿아도 사이에 빈틈이 생긴다.
  octx.drawImage(img, 0, 0, s, s);

  return off;
}

function loadImages() {
  return Promise.all(
    BALL_IMAGES.map((url, i) =>
      new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => {
          imgs[i] = img;
          ballSprites[i] = createBallSprite(img, i + 1);
          resolve();
        };
        img.onerror = () => { imgs[i] = null; resolve(); };
        img.src = url;
      })
    )
  );
}

// ====================================================
// Matter.js 설정
// ====================================================
const { Engine, Bodies, World, Events, Composite } = Matter;
let engine, world;

function initPhysics() {
  engine = Engine.create();
  world  = engine.world;
  engine.gravity.y = 2.5;

  const opt = { isStatic: true, friction: 1, restitution: 0, label: 'wall' };
  World.add(world, [
    Bodies.rectangle(BOARD_WIDTH / 2, BOARD_HEIGHT + 25, BOARD_WIDTH + 100, 50, opt),
    Bodies.rectangle(-25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),
    Bodies.rectangle(BOARD_WIDTH + 25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),
  ]);

  // collisionStart + collisionActive 둘 다 사용 (합체 누락 방지)
  Events.on(engine, 'collisionStart',  onCollision);
  Events.on(engine, 'collisionActive', onCollision);
}

function clearAllBalls() {
  activeBodies.forEach(b => World.remove(world, b));
  activeBodies = [];
  activeBodiesSet.clear();
  mergeQueue.clear();
  dangerTimers.clear();
}

// ====================================================
// 랜덤 단계 생성
// ====================================================
function randomDropLevel() {
  return Math.floor(Math.random() * 5) + 1;
}

// ====================================================
// 공 생성
// ====================================================
function createBall(x, y, level) {
  const radius = BALL_RADII[level - 1];
  const body = Bodies.circle(x, y, radius, {
    restitution: 0,
    friction:    1,
    label:       'ball',
  });

  ballIdCnt++;
  body.gameData = {
    level,
    uid:       ballIdCnt,
    isMerging: false,
    spawnTime: Date.now(),
  };

  World.add(world, body);
  activeBodies.push(body);
  activeBodiesSet.add(body);
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

  createBall(safeX, DROP_Y, lv);
  playDropSound();

  currentLv = nextLv;
  nextLv    = randomDropLevel();
  updateNextPreview();
  buildEvoRing(currentLv);
  setTimeout(() => { canDrop = true; }, DROP_COOLDOWN);
}

// ====================================================
// 합체 감지 (collisionStart + collisionActive)
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
// 근접 공 검사 보조 (바닥 밀착 합체 누락 방지)
// ====================================================
let proximityCheckFrame = 0;

function checkProximityMerges() {
  proximityCheckFrame++;
  if (gameOver) return;
  if (proximityCheckFrame % 3 !== 0) return; // 3프레임마다 1회만 실행

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

      // 닿거나 약간 겹치면 합체 (tolerance 4px)
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
  if (!activeBodiesSet.has(a) || !activeBodiesSet.has(b)) return;

  const mx = (a.position.x + b.position.x) / 2;
  const my = (a.position.y + b.position.y) / 2;

  activeBodies = activeBodies.filter(bd => bd !== a && bd !== b);
  activeBodiesSet.delete(a);
  activeBodiesSet.delete(b);
  dangerTimers.delete(a.gameData.uid);
  dangerTimers.delete(b.gameData.uid);
  World.remove(world, a);
  World.remove(world, b);

  const newLevel    = level + 1;
  const isWatermelon = newLevel === 11;

  score += MERGE_SCORES[level - 1];
  if (score > bestScore) bestScore = score;

  if (isWatermelon) {
    watermelonCount++;
    if (watermelonCount > bestWatermelonCount) bestWatermelonCount = watermelonCount;
  }

  playMergeSound(newLevel);
  addMergeEffect(mx, my, newLevel, isWatermelon);
  createBall(mx, my, newLevel);
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
  ctx.imageSmoothingEnabled  = true;
  ctx.imageSmoothingQuality  = 'high';
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

function drawCloudHolder(x, y, scale = 0.68) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // 은은한 그림자
  ctx.fillStyle = 'rgba(91, 53, 28, 0.10)';
  ctx.beginPath();
  ctx.ellipse(0, 31, 54, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // 구름 본체 — 기존 UI를 건드리지 않는 장식용
  ctx.fillStyle = '#fff1a8';
  ctx.strokeStyle = '#f2cf58';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.arc(-32, 5, 19, 0, Math.PI * 2);
  ctx.arc(-13, -12, 24, 0, Math.PI * 2);
  ctx.arc(14, -12, 25, 0, Math.PI * 2);
  ctx.arc(34, 5, 20, 0, Math.PI * 2);
  ctx.arc(5, 13, 28, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 얼굴
  ctx.fillStyle = '#5b5144';
  ctx.beginPath();
  ctx.arc(-10, 1, 2.1, 0, Math.PI * 2);
  ctx.arc(12, 1, 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#5b5144';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(1, 8, 6, 0, Math.PI);
  ctx.stroke();

  // 작은 손 느낌
  ctx.strokeStyle = '#79c765';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(6, 21);
  ctx.quadraticCurveTo(15, 29, 24, 22);
  ctx.stroke();

  ctx.restore();
}

function toGameX(clientX) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = BOARD_WIDTH / rect.width;
  return (clientX - rect.left) * scaleX;
}

function renderFrame() {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 배경
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
  ctx.font      = "bold 11px 'Pretendard', 'Apple SD Gothic Neo', sans-serif";
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

    const { level } = body.gameData;
    const radius = BALL_RADII[level - 1];
    const img    = ballSprites[level - 1] || imgs[level - 1];
    const { x, y } = body.position;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(body.angle);

    const canDrawImage =
      img &&
      (
        img instanceof HTMLCanvasElement ||
        (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)
      );

    if (canDrawImage) {
      const drawRadius = radius * BALL_DRAW_SCALE;
      ctx.drawImage(img, -drawRadius, -drawRadius, drawRadius * 2, drawRadius * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
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

  // 대기 공 표시
  if (canDrop && !gameOver) {
    const lv     = currentLv;
    const radius = BALL_RADII[lv - 1];
    const img    = ballSprites[lv - 1] || imgs[lv - 1];
    const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));

    // 현재 떨어질 공 뒤쪽에 구름만 추가한다. 게임 로직/기존 UI는 건드리지 않는다.
    // 공에 완전히 가려지지 않도록 공 반지름에 맞춰 구름을 조금 위로 올린다.
    const cloudX = Math.max(52, Math.min(BOARD_WIDTH - 52, safeX));
    const cloudY = Math.max(34, DROP_Y - radius - 24);
    drawCloudHolder(cloudX, cloudY, 0.68);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(safeX, DROP_Y);

    const canDrawImage =
      img &&
      (
        img instanceof HTMLCanvasElement ||
        (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)
      );

    if (canDrawImage) {
      const drawRadius = radius * BALL_DRAW_SCALE;
      ctx.drawImage(img, -drawRadius, -drawRadius, drawRadius * 2, drawRadius * 2);
    } else {
      ctx.fillStyle = FALLBACK_COLORS[lv - 1];
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
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

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) {
    wrap.classList.remove('shake-hard');
    void wrap.offsetWidth;
    wrap.classList.add('shake-hard');

    setTimeout(() => {
      wrap.classList.remove('shake-hard');
    }, 1500);
  }

  const prevBest   = lsGetInt(LS.BEST_SCORE, 0);
  const prevBestWm = lsGetInt(LS.BEST_WATERMELON, 0);
  let scoreUpdated = false;
  let wmUpdated    = false;

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

  setTimeout(() => {
    showGameoverModal(scoreUpdated, wmUpdated);
  }, 1400);

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
  ballIdCnt = 0;
  proximityCheckFrame = 0;
  mergeEffects = [];
  clearAllBalls();
  hideGameoverModal();

  currentLv = 1;
  nextLv    = randomDropLevel();
  dropX     = BOARD_WIDTH / 2;

  updateScoreUI();
  updateNextPreview();
  buildEvoRing(currentLv);

  // 게임루프 재시작
  requestAnimationFrame(gameLoop);
}

// ====================================================
// 메인 게임 루프
// ====================================================
function gameLoop() {
  if (!gameOver) {
    Engine.update(engine, 1000 / 60);
    checkGameOver();
    checkProximityMerges();
  }
  renderFrame();

  if (!gameOver) {
    requestAnimationFrame(gameLoop);
  }
}

// ====================================================
// Firebase 저장
// ====================================================
async function saveToFirebase() {
  if (!firebaseEnabled || !db) return;

  try {
    const docRef   = doc(db, 'scores', playerId);
    const snapshot = await getDoc(docRef);

    // 기존 데이터와 비교해서 더 높은 값만 저장 (덮어씌움 방지)
    const prev     = snapshot.exists() ? snapshot.data() : {};
    const newScore = Math.max(score, prev.score || 0);
    const newWm    = Math.max(watermelonCount, prev.watermelonCount || 0);

    // 실제로 갱신된 값이 없으면 저장 안 함
    if (newScore === (prev.score || 0) && newWm === (prev.watermelonCount || 0)) return;

    await setDoc(docRef, {
      playerId,
      nickname,
      score:           newScore,
      watermelonCount: newWm,
      updatedAt:       serverTimestamp(),
    }, { merge: true });

    // 저장 후 내 최신 데이터를 바로 넘겨서 getDoc 중복 호출 방지
    const myLatest = { playerId, nickname, score: newScore, watermelonCount: newWm };
    await loadRanking(myLatest);

  } catch (e) {
    console.warn('[큐플] Firebase 저장 실패:', e);
  }
}

// ====================================================
// Firebase 랭킹
// ====================================================
async function loadRanking(myLatestData = null) {
  if (!firebaseEnabled || !db) { showEmptyRanking(); return; }
  try {
    const q    = query(collection(db, 'scores'), orderBy('score', 'desc'), limit(10));
    const snap = await getDocs(q);
    if (snap.empty) { showEmptyRanking(); return; }
    const top10 = [];
    snap.forEach(d => top10.push(d.data()));
    top10.sort((a, b) => b.score - a.score || b.watermelonCount - a.watermelonCount);

    // 내가 TOP 10 안에 있는지 확인
    const inTop10 = top10.some(d => d.playerId === playerId);

    // TOP 10 밖이면 내 순위 별도 계산
    let myRankData = null;
    if (!inTop10 && playerId) {
      // saveToFirebase에서 이미 읽은 데이터가 있으면 재활용 (getDoc 중복 방지)
      const myData = myLatestData || await (async () => {
        const mySnap = await getDoc(doc(db, 'scores', playerId));
        return mySnap.exists() ? mySnap.data() : null;
      })();

      if (myData) {
        const aboveQ  = query(
          collection(db, 'scores'),
          orderBy('score', 'desc'),
          limit(500)
        );
        const allSnap = await getDocs(aboveQ);
        let rank = 1;
        allSnap.forEach(d => {
          const dd = d.data();
          if (dd.playerId !== playerId && dd.score > myData.score) rank++;
        });
        myRankData = { ...myData, rank };
      }
    }

    renderRanking(top10, myRankData);
  } catch (e) {
    console.warn('[큐플] 랭킹 불러오기 실패:', e);
    showEmptyRanking();
  }
}

// 빈 랭킹 슬롯 표시
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

function renderRanking(data, myRankData = null) {
  const rows = Array.from({ length: 10 }, (_, i) => {
    const item = data[i];
    const medalClass = i === 0 ? 'rank-1st' : i === 1 ? 'rank-2nd' : i === 2 ? 'rank-3rd' : '';
    if (item) {
      return `
        <div class="rank-row ${medalClass} ${item.playerId === playerId ? 'my-rank' : ''}">
          <span class="rank-num">${i + 1}</span>
          <span class="rank-nick">${escHtml(item.nickname)}</span>
          <span class="rank-score">${(item.score||0).toLocaleString()}P</span>
          <span class="rank-wm">🤎${item.watermelonCount||0}</span>
        </div>`;
    } else {
      return `
        <div class="rank-row ${medalClass}">
          <span class="rank-num">${i + 1}</span>
          <span class="rank-nick empty">-</span>
          <span class="rank-score">-</span>
          <span class="rank-wm">-</span>
        </div>`;
    }
  }).join('');

  // TOP 10 밖 내 순위 표시
  const myRow = myRankData ? `
    <div class="rank-divider"></div>
    <div class="rank-row my-rank my-rank-outside">
      <span class="rank-num">${myRankData.rank}</span>
      <span class="rank-nick">${escHtml(myRankData.nickname)}</span>
      <span class="rank-score">${(myRankData.score||0).toLocaleString()}P</span>
      <span class="rank-wm">🤎${myRankData.watermelonCount||0}</span>
    </div>` : '';

  const html = rows + myRow;
  document.getElementById('ranking-list').innerHTML        = html;
  document.getElementById('mobile-ranking-list').innerHTML = html;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildEvoRing(activeLevel = 0) {
  // 이미 만들어져 있으면 active 클래스만 교체 (DOM 재생성 방지)
  const ring = document.getElementById('evolution-ring');
  if (ring) {
    if (ring.children.length === 0) {
      // 최초 1회 생성
      const cx = 83, cy = 83, r = 65;
      BALL_IMAGES.forEach((url, i) => {
        const level = i + 1;
        const angle = -90 + i * (360 / 11);
        const rad   = angle * Math.PI / 180;
        const div = document.createElement('div');
        div.className = 'ring-item';
        div.dataset.level = level;
        div.style.left = (cx + Math.cos(rad) * r) + 'px';
        div.style.top  = (cy + Math.sin(rad) * r) + 'px';
        const img = document.createElement('img');
        img.src = url;
        img.alt = level + '단계';
        div.appendChild(img);
        ring.appendChild(div);
      });
    }
    // active 클래스만 업데이트
    Array.from(ring.children).forEach(div => {
      div.classList.toggle('active', Number(div.dataset.level) === activeLevel);
    });
  }

  // 모바일 가로형 진화의 고리
  const mobileRow = document.getElementById('mobile-evolution-row');
  if (mobileRow) {
    if (mobileRow.children.length === 0) {
      BALL_IMAGES.forEach((url, i) => {
        const level = i + 1;
        const div = document.createElement('div');
        div.className = 'ring-item';
        div.dataset.level = level;
        const img = document.createElement('img');
        img.src = url;
        img.alt = level + '단계';
        div.appendChild(img);
        mobileRow.appendChild(div);
      });
    }
    Array.from(mobileRow.children).forEach(div => {
      div.classList.toggle('active', Number(div.dataset.level) === activeLevel);
    });
  }
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
  else if (wmUpdated) msg = '🤎 갈뚱 기록 갱신! 더 많이 만들었어요.';
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
    const rawX = toGameX(e.touches[0].clientX);
    dropX = Math.max(0, Math.min(BOARD_WIDTH, rawX));
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (gameOver) return;
    e.preventDefault();
    const rawX = toGameX(e.touches[0].clientX);
    dropX = Math.max(0, Math.min(BOARD_WIDTH, rawX));
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (gameOver || !canDrop) return;
    dropBall();
  }, { passive: false });

  // ── 터치: 캔버스 바깥 파란 영역도 받기 ──
  document.addEventListener('touchstart', e => {
    if (gameOver) return;
    const touch = e.touches[0];
    const rect  = canvas.getBoundingClientRect();
    if (touch.clientX >= rect.left && touch.clientX <= rect.right) return;
    dropX = touch.clientX < rect.left ? 0 : BOARD_WIDTH;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (gameOver) return;
    const touch = e.touches[0];
    const rect  = canvas.getBoundingClientRect();
    if (touch.clientX >= rect.left && touch.clientX <= rect.right) return;
    dropX = touch.clientX < rect.left ? 0 : BOARD_WIDTH;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (gameOver || !canDrop) return;
    const touch = e.changedTouches[0];
    const rect  = canvas.getBoundingClientRect();
    if (touch.clientX >= rect.left && touch.clientX <= rect.right) return;
    dropX = touch.clientX < rect.left ? 0 : BOARD_WIDTH;
    dropBall();
  }, { passive: true });

  // ── PC 마우스: 캔버스 바깥 영역도 받기 ──
  document.addEventListener('mousemove', e => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right) return;
    dropX = e.clientX < rect.left ? 0 : BOARD_WIDTH;
  });

  document.addEventListener('click', e => {
    if (gameOver || !canDrop) return;
    // 버튼, 입력창 등 UI 요소 클릭은 무시
    if (e.target.closest('button, input, a, .overlay, .panel, .mobile-info-bar, .mobile-controls, .mobile-ranking-panel')) return;
    const rect = canvas.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right) return;
    dropX = e.clientX < rect.left ? 0 : BOARD_WIDTH;
    dropBall();
  });
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

  // 첫 공은 무조건 1단계
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
