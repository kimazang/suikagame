/**
 * 큐플 합치기 — game.js
 * Matter.js 물리엔진 + Canvas 2D 렌더링
 * Firebase v10 랭킹 (선택 연동)
 */

// =====================================================
// [1] FIREBASE IMPORTS
// Firebase v10 모듈 방식 CDN import
// =====================================================
import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc,
         collection, query, orderBy, limit,
         getDocs, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// =====================================================
// [2] FIREBASE CONFIG — 여기에 본인 Firebase 설정을 입력하세요
// apiKey가 비어 있으면 Firebase 기능이 자동으로 비활성화됩니다.
// =====================================================
const FIREBASE_CONFIG = {
  apiKey:            "",   // ← 여기에 입력
  authDomain:        "",
  projectId:         "",
  storageBucket:     "",
  messagingSenderId: "",
  appId:             ""
};

// =====================================================
// [3] 게임 상수 — 여기서 쉽게 수정 가능
// =====================================================

/** 게임 보드 픽셀 크기 (물리 세계 기준) */
const BOARD_WIDTH  = 460;
const BOARD_HEIGHT = 640;

/** 게임오버 판정 라인 Y (이 선 위에 공이 2초 이상 → 게임오버) */
const DANGER_Y = 95;

/** 공이 떨어지는 시작 Y 위치 */
const DROP_Y = 55;

/** 드롭 후 다음 공 준비까지 딜레이 (ms) */
const DROP_COOLDOWN = 550;

// ─── 단계별 이미지 URL (1~11단계, 여기서 수정) ───
const BALL_IMAGES = [
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika1.png',   // 1단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika2.png',   // 2단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika3.png',   // 3단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika4.png',   // 4단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika5.png',   // 5단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika6.png',   // 6단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika7.png',   // 7단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika8.png',   // 8단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika9.png',   // 9단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika10.png',  // 10단계
  'https://raw.githubusercontent.com/kimazang/suikagame/main/suika11.png',  // 11단계 (수박)
];

// ─── 단계별 반지름 px (여기서 수정) ───
const BALL_RADII = [18, 24, 32, 42, 54, 68, 84, 102, 124, 150, 178];
//                  1   2   3   4   5   6   7    8    9   10   11

// ─── 합체 시 획득 큐포인트 (새로 생성된 단계 기준, 여기서 수정) ───
// 인덱스 0 = 1단계(드롭만, 0점), 인덱스 1 = 2단계 합체 생성 시, ...
const MERGE_SCORES = [0, 2, 6, 15, 36, 78, 160, 325, 660, 1350, 2800];
//                   1  2  3   4   5   6    7    8    9    10    11

// ─── 드롭 공 단계 랜덤 확률 (1~4단계만) ───
// [단계, 누적확률] 형태
const DROP_WEIGHTS = [
  [1, 0.45],   // 1단계: 45%
  [2, 0.75],   // 2단계: 30%
  [3, 0.93],   // 3단계: 18%
  [4, 1.00],   // 4단계: 7%
];

// ─── localStorage 키 이름 (여기서 수정) ───
const LS = {
  NICKNAME:      'qplay_suika_nickname',
  PLAYER_ID:     'qplay_suika_player_id',
  BEST_SCORE:    'qplay_suika_best_score',
  BEST_WATERMELON: 'qplay_suika_best_watermelon_count',
};

// 폴백 색상 (이미지 로드 실패 시)
const FALLBACK_COLORS = [
  '#9333ea','#3b82f6','#10b981','#f59e0b','#ef4444',
  '#06b6d4','#f97316','#22c55e','#8b5cf6','#0ea5e9','#dc2626'
];

// =====================================================
// [4] Firebase 초기화
// =====================================================
let db = null;
let firebaseEnabled = false;

function initFirebase() {
  try {
    if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.trim() === '') {
      console.warn('[큐플] Firebase config 없음 → 로컬 모드로 실행');
      setRankingMsg('랭킹 기능 준비 중이에요.');
      return;
    }
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    firebaseEnabled = true;
    console.log('[큐플] Firebase 연결 성공');
  } catch (e) {
    console.warn('[큐플] Firebase 초기화 실패:', e);
    setRankingMsg('랭킹 기능 준비 중이에요.');
  }
}

// =====================================================
// [5] localStorage 헬퍼
// =====================================================
function lsGet(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, String(val)); } catch {}
}
function lsGetInt(key, fallback = 0) {
  const n = parseInt(lsGet(key, String(fallback)), 10);
  return isNaN(n) ? fallback : n;
}

// =====================================================
// [6] 게임 상태 변수
// =====================================================
let score             = 0;
let bestScore         = 0;
let watermelonCount   = 0;
let bestWatermelonCount = 0;
let nickname   = '';
let playerId   = '';

let gameOver   = false;
let canDrop    = true;
let currentLv  = 1;   // 지금 드롭할 공 단계
let nextLv     = 1;   // 다음 공 단계 (미리보기)
let dropX      = BOARD_WIDTH / 2; // 공 X 위치

let activeBodies = []; // 살아있는 공 body 목록
let mergeQueue   = new Set(); // 중복 합체 방지 Set (pairKey)
let dangerTimers = new Map(); // uid → 위험 감지 시작 timestamp
let mergeEffects = []; // 시각 효과 목록
let ballIdCnt    = 0;  // 공 고유 ID 카운터

// =====================================================
// [7] 이미지 로드
// =====================================================
const imgs = new Array(11).fill(null); // 단계별 이미지 객체 (0-indexed)

function loadImages() {
  return Promise.all(
    BALL_IMAGES.map((url, i) =>
      new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { imgs[i] = img; resolve(); };
        img.onerror = () => { imgs[i] = null; resolve(); }; // 실패해도 계속
        img.src = url;
      })
    )
  );
}

// =====================================================
// [8] Matter.js 설정
// =====================================================
// Matter.js는 CDN으로 글로벌 로드되어 있음
const { Engine, Bodies, Body, World, Events, Composite } = Matter;

let engine, world;

function initPhysics() {
  engine         = Engine.create();
  world          = engine.world;
  engine.gravity.y = 1.5;

  // 보이지 않는 물리 벽 (바닥 + 좌우)
  const opt = { isStatic: true, friction: 0.5, restitution: 0.1, label: 'wall' };
  World.add(world, [
    Bodies.rectangle(BOARD_WIDTH / 2, BOARD_HEIGHT + 25, BOARD_WIDTH + 100, 50, opt), // 바닥
    Bodies.rectangle(-25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),               // 왼쪽 벽
    Bodies.rectangle(BOARD_WIDTH + 25, BOARD_HEIGHT / 2, 50, BOARD_HEIGHT * 2, opt),  // 오른쪽 벽
  ]);

  // 충돌 이벤트 등록 (합체 감지)
  Events.on(engine, 'collisionStart', onCollision);
}

function clearAllBalls() {
  // 모든 공 제거
  activeBodies.forEach(b => World.remove(world, b));
  activeBodies = [];
  mergeQueue.clear();
  dangerTimers.clear();
}

// =====================================================
// [9] 랜덤 드롭 단계 생성
// =====================================================
function randomDropLevel() {
  const r = Math.random();
  for (const [lv, cumProb] of DROP_WEIGHTS) {
    if (r < cumProb) return lv;
  }
  return 1;
}

// =====================================================
// [10] 공 생성
// =====================================================
function createBall(x, y, level, fromMerge = false) {
  const radius = BALL_RADII[level - 1];

  const body = Bodies.circle(x, y, radius, {
    restitution:   0.2,        // 탄성 (낮을수록 덜 튀김)
    friction:      0.8,        // 마찰
    frictionAir:   0.01,       // 공기 저항
    frictionStatic: 0.5,
    density:       0.001 + level * 0.0002, // 밀도 (클수록 무거움)
    inertia:       Infinity,   // 회전 고정 (얼굴이 돌아가지 않게)
    inverseInertia: 0,
    label:         'ball',
    slop:          0.05,
  });

  ballIdCnt++;
  // body에 게임 데이터 부착
  body.gameData = {
    level,
    uid:         ballIdCnt,
    isMerging:   false,
    spawnTime:   Date.now(),
    popScale:    fromMerge ? 0.1 : 1.0, // 병합 팝 애니메이션 시작 스케일
  };

  World.add(world, body);
  activeBodies.push(body);
  return body;
}

// =====================================================
// [11] 공 드롭
// =====================================================
function dropBall() {
  if (gameOver || !canDrop) return;
  canDrop = false;

  const lv     = currentLv;
  const radius = BALL_RADII[lv - 1];
  const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));

  createBall(safeX, DROP_Y, lv, false);

  // 다음 공 준비
  currentLv = nextLv;
  nextLv    = randomDropLevel();
  updateNextPreview();

  setTimeout(() => { canDrop = true; }, DROP_COOLDOWN);
}

// =====================================================
// [12] 충돌 감지 → 합체 처리
// =====================================================
function onCollision(event) {
  if (gameOver) return;

  event.pairs.forEach(pair => {
    const a = pair.bodyA;
    const b = pair.bodyB;

    // 공이 아닌 body 제외
    if (a.label !== 'ball' || b.label !== 'ball') return;
    if (!a.gameData || !b.gameData) return;

    // 이미 합체 처리 중인 공 제외
    if (a.gameData.isMerging || b.gameData.isMerging) return;

    const lvA = a.gameData.level;
    const lvB = b.gameData.level;

    // 다른 단계끼리 or 11단계(최종)끼리는 합체 안 함
    if (lvA !== lvB || lvA >= 11) return;

    // 스폰 직후 합체 방지 (0.3초 유예)
    const now = Date.now();
    if (now - a.gameData.spawnTime < 300) return;
    if (now - b.gameData.spawnTime < 300) return;

    // 중복 합체 방지 (Set에 pairKey 등록)
    const uidA = a.gameData.uid;
    const uidB = b.gameData.uid;
    const key  = uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
    if (mergeQueue.has(key)) return;
    mergeQueue.add(key);

    a.gameData.isMerging = true;
    b.gameData.isMerging = true;

    // 한 프레임 뒤에 실행 (물리 루프 밖에서 안전하게 처리)
    setTimeout(() => {
      mergeQueue.delete(key);
      mergeBalls(a, b, lvA);
    }, 1);
  });
}

// =====================================================
// [13] 공 합체
// =====================================================
function mergeBalls(a, b, level) {
  // 이미 제거된 공이면 무시
  if (!activeBodies.includes(a) || !activeBodies.includes(b)) return;

  const mx = (a.position.x + b.position.x) / 2;
  const my = (a.position.y + b.position.y) / 2;

  // 두 공 제거
  activeBodies = activeBodies.filter(bd => bd !== a && bd !== b);
  dangerTimers.delete(a.gameData.uid);
  dangerTimers.delete(b.gameData.uid);
  World.remove(world, a);
  World.remove(world, b);

  const newLevel = level + 1; // 생성될 단계

  // 점수 계산 (새로 생성된 단계 기준)
  score += MERGE_SCORES[newLevel - 1];
  if (score > bestScore) bestScore = score;

  // 11단계(수박) 생성 시 수박 카운트 +1
  const isWatermelon = (newLevel === 11);
  if (isWatermelon) {
    watermelonCount++;
    if (watermelonCount > bestWatermelonCount) bestWatermelonCount = watermelonCount;
  }

  // 시각 효과 추가
  addMergeEffect(mx, my, newLevel, isWatermelon);

  // 새 공 생성 (팝 애니메이션 포함)
  createBall(mx, my, newLevel, true);

  // UI 갱신
  updateScoreUI();
}

// =====================================================
// [14] 시각 효과 (합체 파동)
// =====================================================
function addMergeEffect(x, y, level, isWatermelon) {
  mergeEffects.push({
    x, y,
    level,
    isWatermelon,
    startTime: Date.now(),
    duration:  isWatermelon ? 900 : 380,
  });
}

// =====================================================
// [15] 캔버스 렌더링
// =====================================================
let canvas, ctx;

function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  // 캔버스 내부 해상도는 BOARD_WIDTH × BOARD_HEIGHT 고정
  canvas.width  = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;

  // CSS 크기는 컨테이너에 맞게 자동 조절
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap || !canvas) return;
  // CSS 크기만 조정 (픽셀 해상도는 고정)
  const displayW = Math.min(BOARD_WIDTH, wrap.clientWidth);
  canvas.style.width  = displayW + 'px';
  canvas.style.height = (BOARD_HEIGHT * displayW / BOARD_WIDTH) + 'px';
}

/** 마우스/터치 X를 게임 보드 X로 변환 */
function toGameX(clientX) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = BOARD_WIDTH / rect.width;
  return (clientX - rect.left) * scaleX;
}

function renderFrame() {
  // ── 배경 ──
  ctx.fillStyle = '#0d0620';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  // ── 게임오버 위험선 ──
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
  ctx.lineWidth   = 2;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.moveTo(0, DANGER_Y);
  ctx.lineTo(BOARD_WIDTH, DANGER_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(239,68,68,0.55)';
  ctx.font      = '11px sans-serif';
  ctx.fillText('DANGER LINE', 8, DANGER_Y - 5);
  ctx.restore();

  // ── 합체 파동 효과 ──
  const now = Date.now();
  mergeEffects = mergeEffects.filter(eff => {
    const t = (now - eff.startTime) / eff.duration;
    if (t >= 1) return false;

    const alpha  = (1 - t) * 0.9;
    const radius = BALL_RADII[eff.level - 1];

    ctx.save();
    ctx.globalAlpha = alpha;

    if (eff.isWatermelon) {
      // 수박 완성: 황금 이중 파동
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth   = 5;
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, t * 110, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, t * 70, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 일반 합체: 보라 파동
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(eff.x, eff.y, t * (radius + 28), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return true;
  });

  // ── 공 렌더링 ──
  const allBodies = Composite.allBodies(world);
  allBodies.forEach(body => {
    if (body.label !== 'ball' || !body.gameData) return;

    const { level, popScale } = body.gameData;
    const radius = BALL_RADII[level - 1];
    const img    = imgs[level - 1];
    const { x, y } = body.position;

    // 팝 스케일 애니메이션 (합체 후 크게 나타나는 효과)
    if (popScale < 1) {
      body.gameData.popScale = Math.min(1, popScale + 0.15);
    }
    const scale = body.gameData.popScale;

    ctx.save();
    ctx.translate(x, y);
    // inertia=Infinity로 회전 고정했으나 혹시를 대비해 angle 적용
    // ctx.rotate(body.angle); // 얼굴이 돌아가면 주석 해제

    ctx.scale(scale, scale);

    // 원형 클리핑
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (img && img.complete && img.naturalWidth > 0) {
      // 이미지 렌더링
      ctx.drawImage(img, -radius, -radius, radius * 2, radius * 2);
    } else {
      // 폴백: 색상 원 + 숫자
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

  // ── 미리보기 공 (드롭할 공) ──
  if (canDrop && !gameOver) {
    const lv     = currentLv;
    const radius = BALL_RADII[lv - 1];
    const img    = imgs[lv - 1];
    const safeX  = Math.max(radius + 1, Math.min(BOARD_WIDTH - radius - 1, dropX));

    // 가이드 라인
    ctx.save();
    ctx.strokeStyle = 'rgba(168,85,247,0.28)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(safeX, DROP_Y + radius + 4);
    ctx.lineTo(safeX, BOARD_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 미리보기 공
    ctx.save();
    ctx.translate(safeX, DROP_Y);
    ctx.globalAlpha = 0.78;
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

  // ── 게임오버 오버레이 (물리 멈춘 후 표시) ──
  if (gameOver) {
    ctx.fillStyle = 'rgba(6,2,20,0.45)';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  }
}

// =====================================================
// [16] 게임오버 감지
// =====================================================
function checkGameOver() {
  if (gameOver) return;
  const now = Date.now();

  for (const body of activeBodies) {
    if (!body.gameData || body.gameData.isMerging) continue;

    const level  = body.gameData.level;
    const radius = BALL_RADII[level - 1];
    const age    = now - body.gameData.spawnTime;

    // 스폰 후 1.5초 이내는 판정 제외
    if (age < 1500) continue;

    const topY = body.position.y - radius;
    const vx   = Math.abs(body.velocity.x);
    const vy   = Math.abs(body.velocity.y);
    const isStable = vx < 1.0 && vy < 1.0;

    if (topY < DANGER_Y && isStable) {
      const uid = body.gameData.uid;
      if (!dangerTimers.has(uid)) {
        dangerTimers.set(uid, now);
      } else if (now - dangerTimers.get(uid) > 2000) {
        // 2초 이상 위험선 위에 안정적으로 있음 → 게임오버
        endGame();
        return;
      }
    } else {
      dangerTimers.delete(body.gameData.uid);
    }
  }
}

// =====================================================
// [17] 게임 종료
// =====================================================
async function endGame() {
  if (gameOver) return;
  gameOver = true;

  // 개인 최고 기록 갱신
  const prevBest = lsGetInt(LS.BEST_SCORE, 0);
  const prevBestWm = lsGetInt(LS.BEST_WATERMELON, 0);

  let scoreUpdated = false;
  let wmUpdated    = false;

  if (score > prevBest) {
    lsSet(LS.BEST_SCORE, score);
    bestScore     = score;
    scoreUpdated  = true;
  }
  if (watermelonCount > prevBestWm) {
    lsSet(LS.BEST_WATERMELON, watermelonCount);
    bestWatermelonCount = watermelonCount;
    wmUpdated = true;
  }

  // Firebase 저장 (기록 갱신이 있을 때만)
  if (firebaseEnabled && nickname && (scoreUpdated || wmUpdated)) {
    await saveToFirebase();
  }

  updateScoreUI();
  showGameoverModal(scoreUpdated, wmUpdated);
}

// =====================================================
// [18] 게임 재시작
// =====================================================
function restartGame() {
  gameOver        = false;
  canDrop         = true;
  score           = 0;
  watermelonCount = 0;
  mergeEffects    = [];

  clearAllBalls();
  hideGameoverModal();

  currentLv = randomDropLevel();
  nextLv    = randomDropLevel();
  dropX     = BOARD_WIDTH / 2;

  updateScoreUI();
  updateNextPreview();
}

// =====================================================
// [19] 메인 게임 루프
// =====================================================
function gameLoop() {
  // 게임오버 아닐 때만 물리 업데이트 + 게임오버 체크
  if (!gameOver) {
    Engine.update(engine, 1000 / 60);
    checkGameOver();
  }
  // 렌더링은 항상 실행
  renderFrame();
  requestAnimationFrame(gameLoop);
}

// =====================================================
// [20] Firebase 저장
// =====================================================
async function saveToFirebase() {
  if (!firebaseEnabled || !db) return;

  try {
    const docRef    = doc(db, 'scores', playerId);
    const existing  = await getDoc(docRef);

    // 기존 기록보다 낮은 값으로 덮어쓰지 않도록 max 유지
    let finalScore  = score;
    let finalWm     = watermelonCount;

    if (existing.exists()) {
      const d    = existing.data();
      finalScore = Math.max(score, d.score || 0);
      finalWm    = Math.max(watermelonCount, d.watermelonCount || 0);
    }

    await setDoc(docRef, {
      playerId,
      nickname,
      score:           finalScore,
      watermelonCount: finalWm,
      updatedAt:       serverTimestamp(),
    });

    // 랭킹 새로고침
    await loadRanking();
  } catch (e) {
    console.warn('[큐플] Firebase 저장 실패:', e);
  }
}

// =====================================================
// [21] Firebase 랭킹 불러오기
// =====================================================
async function loadRanking() {
  if (!firebaseEnabled || !db) {
    setRankingMsg('랭킹 기능 준비 중이에요.');
    return;
  }

  try {
    const q    = query(collection(db, 'scores'), orderBy('score', 'desc'), limit(10));
    const snap = await getDocs(q);

    if (snap.empty) {
      setRankingMsg('아직 등록된 랭킹이 없어요.');
      return;
    }

    // 동점이면 watermelonCount 내림차순
    const data = [];
    snap.forEach(d => data.push(d.data()));
    data.sort((a, b) => b.score - a.score || b.watermelonCount - a.watermelonCount);

    renderRanking(data);
  } catch (e) {
    console.warn('[큐플] 랭킹 불러오기 실패:', e);
    setRankingMsg('랭킹을 불러오지 못했어요.');
  }
}

function setRankingMsg(msg) {
  const html = `<div class="ranking-placeholder">${msg}</div>`;
  document.getElementById('ranking-list').innerHTML = html;
  document.getElementById('mobile-ranking-list').innerHTML = html;
}

function renderRanking(data) {
  const html = data.map((item, i) => `
    <div class="rank-row ${item.playerId === playerId ? 'my-rank' : ''}">
      <span class="rank-num">${i + 1}</span>
      <span class="rank-nick">${escHtml(item.nickname)}</span>
      <span class="rank-score">${(item.score || 0).toLocaleString()}P</span>
      <span class="rank-wm">🍉${item.watermelonCount || 0}</span>
    </div>
  `).join('');

  document.getElementById('ranking-list').innerHTML = html;
  document.getElementById('mobile-ranking-list').innerHTML = html;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// =====================================================
// [22] UI 업데이트
// =====================================================
function updateScoreUI() {
  const bs  = Math.max(score, lsGetInt(LS.BEST_SCORE, 0));
  const bwm = Math.max(watermelonCount, lsGetInt(LS.BEST_WATERMELON, 0));

  setText('score-display',    score.toLocaleString());
  setText('best-display',     bs.toLocaleString());
  setText('wm-display',       watermelonCount + '개');
  setText('best-wm-display',  bwm + '개');

  setText('mob-score',        score.toLocaleString());
  setText('mob-best',         bs.toLocaleString());
  setText('mob-wm',           watermelonCount);
  setText('mob-rank-best',    bs.toLocaleString());
}

function updateNextPreview() {
  const src = imgs[nextLv - 1]?.src || BALL_IMAGES[nextLv - 1];
  setImgSrc('next-ball-img', src);
  setImgSrc('mob-next-img',  src);
}

function updatePlayerDisplay() {
  setText('player-display', `플레이어: ${nickname}`);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setImgSrc(id, src) {
  const el = document.getElementById(id);
  if (el) el.src = src;
}

// =====================================================
// [23] 게임오버 모달
// =====================================================
function showGameoverModal(scoreUpdated, wmUpdated) {
  const bs  = Math.max(score, lsGetInt(LS.BEST_SCORE, 0));
  const bwm = Math.max(watermelonCount, lsGetInt(LS.BEST_WATERMELON, 0));

  setText('go-player',   `플레이어: ${nickname}`);
  setText('go-score',    score.toLocaleString() + 'P');
  setText('go-best',     bs.toLocaleString() + 'P');
  setText('go-wm',       watermelonCount + '개');
  setText('go-best-wm',  bwm + '개');

  let msg = '아쉽지만 최고 기록에는 도달하지 못했어요.';
  if (scoreUpdated)   msg = '🎉 최고 기록 갱신! 랭킹에 반영됐어요.';
  else if (wmUpdated) msg = '🍉 수박 기록 갱신! 이번 판에서 수박을 더 많이 만들었어요.';
  setText('go-message', msg);

  document.getElementById('gameover-modal').classList.remove('hidden');
}

function hideGameoverModal() {
  document.getElementById('gameover-modal').classList.add('hidden');
}

// =====================================================
// [24] 닉네임 모달
// =====================================================
function showNicknameModal() {
  const el = document.getElementById('nickname-modal');
  el.classList.remove('hidden');
  const input = document.getElementById('nickname-input');
  input.value = nickname || '';
  document.getElementById('nickname-error').textContent = '';
  setTimeout(() => input.focus(), 100);
}

function hideNicknameModal() {
  document.getElementById('nickname-modal').classList.add('hidden');
}

function confirmNickname() {
  const raw   = document.getElementById('nickname-input').value;
  const input = raw.trim();
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

// =====================================================
// [25] 입력 처리 (마우스 + 터치)
// =====================================================
function initInput() {
  // ── 마우스 ──
  canvas.addEventListener('mousemove', e => {
    if (gameOver) return;
    dropX = toGameX(e.clientX);
  });

  canvas.addEventListener('click', e => {
    // 모달이 열려있으면 무시
    if (gameOver) return;
    if (!canDrop) return;
    dropBall();
  });

  // ── 터치 ──
  let touchMoved = false;

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    touchMoved = false;
    if (gameOver) return;
    dropX = toGameX(e.touches[0].clientX);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    touchMoved = true;
    if (gameOver) return;
    dropX = toGameX(e.touches[0].clientX);
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (gameOver || !canDrop) return;
    // 탭(move 없음) or 슬라이드 후 릴리즈 → 드롭
    dropBall();
  }, { passive: false });
}

// =====================================================
// [26] 초기화
// =====================================================
async function init() {
  // 로컬 데이터 로드
  nickname  = lsGet(LS.NICKNAME, '');
  playerId  = lsGet(LS.PLAYER_ID, '');
  bestScore = lsGetInt(LS.BEST_SCORE, 0);
  bestWatermelonCount = lsGetInt(LS.BEST_WATERMELON, 0);

  // playerId 없으면 생성
  if (!playerId) {
    playerId = crypto.randomUUID();
    lsSet(LS.PLAYER_ID, playerId);
  }

  // Firebase 초기화 (실패해도 게임은 계속)
  initFirebase();

  // 이미지 로드 (실패 허용)
  await loadImages();

  // 캔버스 & 물리 초기화
  initCanvas();
  initPhysics();

  // 입력 이벤트
  initInput();

  // 버튼 이벤트 바인딩
  bind('nickname-confirm-btn', 'click', confirmNickname);
  bind('nickname-input', 'keydown', e => { if (e.key === 'Enter') confirmNickname(); });
  bind('change-nickname-btn', 'click', showNicknameModal);
  bind('mob-change-nick-btn', 'click', showNicknameModal);

  bind('restart-btn',     'click', restartGame);
  bind('mob-restart-btn', 'click', restartGame);

  bind('go-restart-btn',  'click', () => { hideGameoverModal(); restartGame(); });
  bind('go-ranking-btn',  'click', () => { hideGameoverModal(); showMobileRanking(); });
  bind('go-nickname-btn', 'click', () => { hideGameoverModal(); showNicknameModal(); });

  bind('mob-ranking-btn',   'click', showMobileRanking);
  bind('mob-ranking-close', 'click', hideMobileRanking);

  // 첫 접속 닉네임 없으면 설정창 표시
  if (!nickname) {
    showNicknameModal();
  } else {
    updatePlayerDisplay();
  }

  // 초기 공 준비
  currentLv = randomDropLevel();
  nextLv    = randomDropLevel();
  updateScoreUI();
  updateNextPreview();

  // 랭킹 불러오기
  loadRanking();

  // 게임 루프 시작
  requestAnimationFrame(gameLoop);
}

function bind(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

function showMobileRanking() {
  document.getElementById('mobile-ranking-panel').classList.remove('hidden');
}
function hideMobileRanking() {
  document.getElementById('mobile-ranking-panel').classList.add('hidden');
}

// 시작
init();
