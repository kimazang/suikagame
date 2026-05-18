/**
 * 1991 만들기 — game.js
 * - 물리: Matter.js (gravity 1.0, friction 1, restitution 0, frictionStatic 0.5)
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
         getDocs, serverTimestamp, runTransaction }
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

// 전체 물리 속도 보정
// 1.00 = 기존 속도, 1.15 = 15% 빠르게, 1.25 = 25% 빠르게
const PHYSICS_SPEED = 1.7;
const MAX_PHYSICS_DELTA = 50; // 모바일 렉/프레임 저하 시 튐 방지용 상한 ms

// 이미지 URL (여기서 수정)
const BALL_IMAGES = [
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika1.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika2.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika3.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika4.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika5.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika6.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika7.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika8.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika9.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika10.png?v=1991-9',
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika11.png?v=1991-9',
];

// 구름 이미지 URL — GitHub suikagame 폴더의 cloud.png를 사용
// github.com/.../blob/... 주소보다 raw.githubusercontent.com 주소가 이미지 로딩에 안정적이다.
const CLOUD_IMAGE_URL = 'https://raw.githubusercontent.com/kimazang/suikagame/main/cloud.png?v=1991-9';

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
let soundEnabled = true; // 효과음 on/off

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

// 비눗방울 터지는 소리 생성기
// sine 오실레이터 + 짧은 피치 드롭 = 통통 튀는 귀여운 방울 소리
function playBubblePop(actx, freq, vol, delay = 0) {
  try {
    const t = actx.currentTime + delay;

    // 메인: 높은 음에서 빠르게 내려오는 "퐁"
    const osc  = actx.createOscillator();
    const gain = actx.createGain();
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.06);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.start(t);
    osc.stop(t + 0.1);

    // 보조: 살짝 높은 하모닉으로 통통한 느낌 추가
    const osc2  = actx.createOscillator();
    const gain2 = actx.createGain();
    osc2.connect(gain2);
    gain2.connect(actx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.4, t);
    osc2.frequency.exponentialRampToValueAtTime(freq * 0.9, t + 0.05);
    gain2.gain.setValueAtTime(vol * 0.35, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc2.start(t);
    osc2.stop(t + 0.08);
  } catch (e) {}
}

// 드롭 효과음: 가볍게 퐁~
function playDropSound() {
  if (!soundEnabled) return;
  const actx = getAudio();
  if (!actx) return;
  playBubblePop(actx, 880, 0.18);
}

// 합체 효과음: 방울 터지는 퐁! (레벨 높을수록 낮고 통통)
function playMergeSound(level) {
  if (!soundEnabled) return;
  const actx = getAudio();
  if (!actx) return;
  try {
    // 1단계=1400Hz 높고 귀엽게 → 11단계=600Hz 낮고 통통하게
    const freq = 1400 - level * 73;
    const vol  = 0.22 + level * 0.01;
    playBubblePop(actx, freq, vol);

    // 구일(11단계) — 퐁퐁퐁퐁 연속
    if (level === 11) {
      [700, 900, 800, 1100].forEach((f, i) => {
        playBubblePop(actx, f, 0.2, (i + 1) * 0.1);
      });
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
let cloudImg = null;

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

function loadCloudImage() {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      cloudImg = img;
      resolve();
    };
    img.onerror = () => {
      console.warn('[큐플] cloud.png 로드 실패:', CLOUD_IMAGE_URL);
      cloudImg = null;
      resolve();
    };
    img.src = CLOUD_IMAGE_URL;
  });
}

function loadImages() {
  const ballImagePromises = BALL_IMAGES.map((url, i) =>
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
  );

  // 공 이미지와 구름 이미지를 함께 미리 로드한다.
  // 그래야 게임 시작 후 구름이 늦게 나타나거나 깜빡이는 느낌이 줄어든다.
  return Promise.all([...ballImagePromises, loadCloudImage()]);
}

// ====================================================
// Matter.js 설정
// ====================================================
const { Engine, Bodies, World, Events, Composite } = Matter;
let engine, world;

function initPhysics() {
  engine = Engine.create();
  world  = engine.world;
  engine.gravity.y = 1.0; // 레퍼런스 Phaser gravity.y=1.5 체감 환산값
  // 공끼리 겹쳐 보이는 현상을 줄이기 위해 물리 보정 반복 횟수를 올린다.
  // 이미지 크기를 키우는 방식은 겹침을 더 심하게 만들 수 있어서 사용하지 않는다.
  // 레퍼런스 기본값 유지 (positionIterations:6, velocityIterations:4)

  const opt = { isStatic: true, friction: 1, restitution: 0, frictionStatic: 0.5, label: 'wall' };
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
    restitution:   0,
    friction:      1,
    frictionStatic: 0.5, // 레퍼런스와 동일
    frictionAir:   0.01, // 레퍼런스 Phaser 기본값
    slop:          0.01,
    label:         'ball',
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
  if (lvA !== lvB) return;

  // 11단계끼리는 터지면서 사라짐
  if (lvA === 11) {
    const uidA = a.gameData.uid;
    const uidB = b.gameData.uid;
    const key  = uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
    if (mergeQueue.has(key)) return;
    mergeQueue.add(key);
    a.gameData.isMerging = true;
    b.gameData.isMerging = true;
    explodeBalls(a, b);
    mergeQueue.delete(key);
    return;
  }

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
      if (lvA !== lvB) continue;

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
// 11단계 폭발 (터지면서 사라짐)
// ====================================================
function explodeBalls(a, b) {
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

  // 점수 추가 (11단계 합체 점수)
  score += MERGE_SCORES[10];
  if (score > bestScore) bestScore = score;

  watermelonCount++;
  if (watermelonCount > bestWatermelonCount) bestWatermelonCount = watermelonCount;

  playMergeSound(11);
  addMergeEffect(mx, my, 11, true);
  updateScoreUI();
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
  // 사과게임처럼 은은한 불꽃놀이가 팝! 하고 퍼지는 효과.
  // 수정 포인트: 반응은 즉각적으로, 알갱이는 과하지 않게 약 5개만 사용한다.
  const radius = BALL_RADII[level - 1];
  const particles = [];
  const particleCount = isWatermelon ? 7 : 5;

  for (let i = 0; i < particleCount; i++) {
    const baseAngle = Math.PI * 2 * (i / particleCount);
    const angle = baseAngle + (Math.random() * 0.56 - 0.28);
    const distance = radius * (1.02 + Math.random() * 0.42);

    particles.push({
      angle,
      distance,
      size: (isWatermelon ? 3.0 : 2.4) + Math.random() * (isWatermelon ? 2.4 : 1.8),
      delay: Math.random() * 38, // 거의 즉각적으로 터지게
      drift: (Math.random() * 2 - 1) * radius * 0.07,
      fall: Math.random() * radius * 0.10,
      colorType: Math.random(),
      twinkle: Math.random() > 0.46,
      cross: Math.random() > 0.68,
    });
  }

  mergeEffects.push({
    x, y, level, isWatermelon,
    radius,
    particles,
    startTime: Date.now(),
    duration:  isWatermelon ? 1050 : 880,
  });
}

function renderMergeEffects(now) {
  mergeEffects = mergeEffects.filter(eff => {
    const rawT = (now - eff.startTime) / eff.duration;
    if (rawT >= 1) return false;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';

    // 파티클 알갱이만 표시 (링/도넛 이펙트 없음)
    const particles = eff.particles || [];
    particles.forEach(pt => {
      const localRaw = (now - eff.startTime - pt.delay) / Math.max(1, eff.duration - pt.delay);
      if (localRaw <= 0 || localRaw >= 1) return;

      const localT = 1 - Math.pow(1 - localRaw, 2.85);
      const slowFade = Math.pow(1 - localRaw, 1.05);
      const travel = pt.distance * localT;
      const px = eff.x + Math.cos(pt.angle) * travel + pt.drift * localT;
      const py = eff.y + Math.sin(pt.angle) * travel + pt.fall * localRaw * localRaw;
      const size = pt.size * (0.82 + localT * 0.46);

      let fill = 'rgba(255,255,255,0.98)';
      if (pt.colorType > 0.66) fill = 'rgba(255,232,106,0.95)';
      else if (pt.colorType > 0.42) fill = 'rgba(255,250,196,0.96)';

      // 은은하게 번지는 글로우
      ctx.globalAlpha = slowFade * 0.26;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(px, py, size * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // 중심 알갱이
      ctx.globalAlpha = slowFade * 0.95;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();

      // 십자 반짝임. 너무 별 모양으로 과하지 않게 짧게.
      if (pt.twinkle) {
        const len = size * (pt.cross ? 3.2 : 2.3) * (1 - localRaw * 0.25);
        ctx.globalAlpha = slowFade * 0.72;
        ctx.strokeStyle = 'rgba(255,255,255,0.98)';
        ctx.lineWidth = Math.max(0.9, size * 0.36);
        ctx.beginPath();
        ctx.moveTo(px - len, py);
        ctx.lineTo(px + len, py);
        ctx.moveTo(px, py - len);
        ctx.lineTo(px, py + len);
        ctx.stroke();
      }
    });

    ctx.restore();
    return true;
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

function drawCloudHolder(x) {
  // 사용자가 직접 만든 cloud.png만 사용한다.
  // 구름 높이는 공 크기와 상관없이 항상 고정한다.
  if (!cloudImg || !cloudImg.complete || !cloudImg.naturalWidth) return;

  const cloudW = 92;
  const cloudH = cloudW * (cloudImg.naturalHeight / cloudImg.naturalWidth);

  // 치명적 오류 수정:
  // 기존에는 현재 공 반지름(ballRadius)에 따라 cloudY를 계산해서
  // 공을 떨어뜨릴 때마다 구름 높이가 위아래로 바뀌었다.
  // 이제 구름은 항상 같은 높이에 고정된다.
  const cloudY = 14;

  ctx.save();
  ctx.drawImage(cloudImg, x - cloudW / 2, cloudY, cloudW, cloudH);
  ctx.restore();
}

function toGameX(clientX) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = BOARD_WIDTH / rect.width;
  return (clientX - rect.left) * scaleX;
}

function renderFrame() {
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

  // 합체 POP 효과는 공을 그린 뒤에 한 번 더 그려서 약해 보이지 않게 처리한다.
  const now = Date.now();

  // 구름은 모든 공보다 먼저 그린다.
  // 그래야 공을 떨어뜨린 직후 생성된 물리 공이 구름 뒤로 숨어 보이지 않는다.
  let sharedCloudX = BOARD_WIDTH / 2;
  if (!gameOver) {
    const radiusForCloud = BALL_RADII[currentLv - 1];
    const safeXForCloud  = Math.max(radiusForCloud + 1, Math.min(BOARD_WIDTH - radiusForCloud - 1, dropX));
    sharedCloudX = Math.max(46, Math.min(BOARD_WIDTH - 46, safeXForCloud));
    drawCloudHolder(sharedCloudX);
  }

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
      ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
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

  // 합체 이펙트는 공 위에 보이도록 여기서 렌더링한다.
  // 그래야 새로 생긴 공에 가려져서 약해 보이지 않는다.
  renderMergeEffects(now);

  // 대기 공 / 구름 표시
  // IMPORTANT:
  // 기존에는 canDrop일 때만 대기 공과 구름을 그려서,
  // 공을 떨어뜨린 직후 쿨다운 600ms 동안 구름이 사라지는 것처럼 보였다.
  // 그래서 렉 걸리는 듯한 끊김이 생겼다.
  // 이제 구름과 현재 대기 공은 게임오버가 아니면 항상 위에서 마우스를 따라다닌다.
  if (!gameOver) {
    const lv     = currentLv;
    const radius = BALL_RADII[lv - 1];
    const img    = ballSprites[lv - 1] || imgs[lv - 1];
    const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));

    // 대기공은 canDrop일 때만 표시 (쿨다운 중엔 숨김)
    if (canDrop) {
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
        ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
      } else {
        ctx.fillStyle = FALLBACK_COLORS[lv - 1];
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
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
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
}

// ====================================================
// 메인 게임 루프
// ====================================================
let lastFrameTime = performance.now();

function gameLoop(now = performance.now()) {
  const rawDelta = now - lastFrameTime;
  const delta = Math.min(rawDelta, MAX_PHYSICS_DELTA);
  lastFrameTime = now;

  if (!gameOver) {
    Engine.update(engine, delta * PHYSICS_SPEED);
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
          <span class="rank-wm">🫦${item.watermelonCount||0}</span>
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
      <span class="rank-wm">🫦${myRankData.watermelonCount||0}</span>
    </div>` : '';

  const html = rows + myRow;
  document.getElementById('ranking-list').innerHTML        = html;
  document.getElementById('mobile-ranking-list').innerHTML = html;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function normalizeNickname(name) {
  return String(name).trim().toLowerCase();
}

async function reserveNickname(newNickname) {
  if (!firebaseEnabled || !db) return true;

  const normalized = normalizeNickname(newNickname);
  const nickRef = doc(db, 'nicknames', normalized);

  const oldNickname = lsGet(LS.NICKNAME, '');
  const oldNormalized = normalizeNickname(oldNickname);
  const oldRef = oldNormalized && oldNormalized !== normalized
    ? doc(db, 'nicknames', oldNormalized)
    : null;

  try {
    await runTransaction(db, async (tx) => {
      // 1) 읽기는 먼저 전부
      const nickSnap = await tx.get(nickRef);
      const oldSnap = oldRef ? await tx.get(oldRef) : null;

      // 2) 중복 닉네임 검사
      if (nickSnap.exists()) {
        const data = nickSnap.data();

        if (data.playerId !== playerId) {
          throw new Error('DUPLICATE_NICKNAME');
        }
      }

      // 3) 새 닉네임 예약
      tx.set(nickRef, {
        playerId,
        nickname: newNickname,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      // 4) 예전 닉네임 문서 삭제
      if (
        oldRef &&
        oldSnap &&
        oldSnap.exists() &&
        oldSnap.data().playerId === playerId
      ) {
        tx.delete(oldRef);
      }
    });

    return true;
  } catch (e) {
    if (e.message === 'DUPLICATE_NICKNAME') return false;

    console.warn('[큐플] 닉네임 예약 실패:', e);
    return false;
  }
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
  setText('mob-wm',          watermelonCount + '개');
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
  else if (wmUpdated) msg = '🫦 1991 기록 갱신! 더 많이 만들었어요.';
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

async function confirmNickname() {
  const input = document.getElementById('nickname-input').value.trim();
  const errEl = document.getElementById('nickname-error');
  const btnEl = document.getElementById('nickname-confirm-btn');

  if (input.length < 2 || input.length > 10) {
    errEl.textContent = '닉네임은 2~10글자여야 해요.';
    return;
  }

  // 중복 클릭 방지
  if (btnEl) btnEl.disabled = true;
  errEl.textContent = '닉네임 확인 중...';

  const ok = await reserveNickname(input);

  if (!ok) {
    errEl.textContent = '이미 사용 중인 닉네임이에요.';
    if (btnEl) btnEl.disabled = false;
    return;
  }

  nickname = input;
  lsSet(LS.NICKNAME, nickname);
  updatePlayerDisplay();
  hideNicknameModal();
  if (btnEl) btnEl.disabled = false;
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
    if (e.target.closest('button, input, a, .overlay, .panel, .mobile-info-bar, .mobile-controls, .mobile-ranking-panel, .pc-controls, .pc-quick-btns, .pc-title, .credit')) return;
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
  bind('restart-btn',       'click', restartGame);
  bind('mob-restart-btn',   'click', restartGame);
  bind('go-restart-btn',    'click', () => { hideGameoverModal(); restartGame(); });
  bind('go-ranking-btn',    'click', () => { hideGameoverModal(); showMobileRanking(); });
  bind('go-nickname-btn',   'click', () => { hideGameoverModal(); showNicknameModal(); });
  bind('mob-ranking-btn',   'click', showMobileRanking);
  bind('mob-ranking-close', 'click', hideMobileRanking);
  bind('mob-change-nick-btn',  'click', showNicknameModal);
  bind('change-nickname-btn',  'click', showNicknameModal);
  bind('sound-toggle-btn',     'click', toggleSound);
  bind('mob-sound-btn',        'click', toggleSound);

  // 닉네임 없으면 모달
  if (!nickname) { showNicknameModal(); }
  else { updatePlayerDisplay(); }

  // 첫 공은 무조건 1단계
  currentLv = 1;
  nextLv    = randomDropLevel();

  updateScoreUI();
  updateNextPreview();
  buildEvoRing(currentLv);
  updateSoundButtons();
  showEmptyRanking();
  loadRanking();

  requestAnimationFrame(gameLoop);
}

function bind(id, ev, fn) { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }
function showMobileRanking() { document.getElementById('mobile-ranking-panel').classList.remove('hidden'); }
function hideMobileRanking() { document.getElementById('mobile-ranking-panel').classList.add('hidden'); }

function toggleSound() {
  soundEnabled = !soundEnabled;
  updateSoundButtons();
}

function updateSoundButtons() {
  const isOn   = soundEnabled;
  const pcBtn  = document.getElementById('sound-toggle-btn');
  const mobBtn = document.getElementById('mob-sound-btn');

  if (pcBtn) {
    pcBtn.textContent = isOn ? '🔊 ON' : '🔇 OFF';
    pcBtn.className   = isOn ? 'sound-toggle on' : 'sound-toggle off';
  }

  if (mobBtn) {
    mobBtn.textContent = isOn ? '🔊 ON' : '🔇 OFF';
    mobBtn.className   = isOn ? 'sound-toggle on' : 'sound-toggle off';
  }
}

init();
