/**
 * 큐플 얼굴 합치기 게임 로직
 * Phaser 3 + Matter.js 기반
 */

// ==========================================
// 1. 설정 및 데이터
// ==========================================

const GAME_WIDTH = 650;
const GAME_HEIGHT = 720;
const DROP_LINE_Y = 100; // 위험선 높이
const WALL_THICKNESS = 60; // 보이지 않는 벽 두께
const COOLDOWN_TIME = 600; // 공 드롭 쿨타임 (ms)

// 공 단계 데이터 정의
const BALLS = [
    { level: 1, key: "suika1", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika1.png", radius: 24, score: 1 },
    { level: 2, key: "suika2", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika2.png", radius: 30, score: 3 },
    { level: 3, key: "suika3", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika3.png", radius: 38, score: 6 },
    { level: 4, key: "suika4", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika4.png", radius: 48, score: 10 },
    { level: 5, key: "suika5", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika5.png", radius: 60, score: 15 },
    { level: 6, key: "suika6", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika6.png", radius: 74, score: 21 },
    { level: 7, key: "suika7", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika7.png", radius: 90, score: 28 },
    { level: 8, key: "suika8", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika8.png", radius: 108, score: 36 },
    { level: 9, key: "suika9", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika9.png", radius: 128, score: 45 },
    { level: 10, key: "suika10", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika10.png", radius: 150, score: 55 },
    { level: 11, key: "suika11", image: "https://raw.githubusercontent.com/kimazang/suikagame/main/suika11.png", radius: 176, score: 66 }
];

// 게임 상태 변수
let currentScore = 0;
let bestScore = localStorage.getItem('qplayMergeBestScore') || 0;
let isGameOver = false;
let nextBallLevel = 1;
let canDrop = true;
let lastPointerX = GAME_WIDTH / 2; // 마지막 마우스 위치 저장
let activeBalls = []; // 화면에 있는 공들 관리

// ==========================================
// 2. Phaser Scene 클래스
// ==========================================

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    // 초기화
    init() {
        isGameOver = false;
        currentScore = 0;
        canDrop = true;
        activeBalls = [];
        this.updateScoreUI();
    }

    // 리소스 로드
    preload() {
        // 배경색 설정 (CSS와 통일감)
        this.cameras.main.setBackgroundColor('#eef7fd');

        // GitHub 원본 이미지 로드
        BALLS.forEach(ball => {
            // CORS 문제 방지를 위해 로드 방식 설정 (GitHub Raw는 기본적으로 허용됨)
            this.load.image(ball.key, ball.image);
        });

        // 파티클 기본 이미지 (흰색 원 생성해서 사용)
        const graphics = this.add.graphics();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(4, 4, 4);
        graphics.generateTexture('particle_base', 8, 8);
        graphics.destroy();
        
        // 사운드 로드 위치 (나중에 추가 시 여기 주석 해제)
        // this.load.audio('dropSound', 'assets/drop.mp3');
        // this.load.audio('mergeSound', 'assets/merge.mp3');
        // this.load.audio('gameoverSound', 'assets/gameover.mp3');
    }

    // 게임 객체 생성
    create() {
        // 월드 경계 설정
        this.matter.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT, WALL_THICKNESS, true, true, false, true);

        // 상단 위험선 그리기 (귀여운 점선 느낌)
        this.drawDangerLine();

        // 첫 번째 다음 공 준비
        this.setNextBall();

        // 입력 이벤트 설정
        this.setupInputs();

        // 충돌 이벤트 설정
        this.setupCollisions();

        // 미리보기 가이드라인 생성
        this.previewLine = this.add.line(0, 0, 0, 0, 0, GAME_HEIGHT, 0xffffff, 0.3).setOrigin(0, 0);
        
        // 드롭 대기 중인 반투명 공 생성
        this.previewBall = this.add.image(lastPointerX, DROP_LINE_Y / 2, BALLS[nextBallLevel - 1].key)
            .setAlpha(0.5)
            .setDisplaySize(BALLS[nextBallLevel - 1].radius * 2, BALLS[nextBallLevel - 1].radius * 2);
    }

    // 매 프레임 업데이트
    update(time, delta) {
        if (isGameOver) return;

        // 게임 오버 체크
        this.checkGameOver(time);
        
        // 미리보기 업데이트
        this.updatePreviewPosition();
    }

    // ==========================================
    // 3. 게임 로직 메서드
    // ==========================================

    drawDangerLine() {
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0xff8e8b, 0.5); // 연한 코랄 핑크 점선 느낌
        
        // 점선 그리기 수동 구현
        const dashLength = 10;
        const gapLength = 10;
        for (let x = 0; x < GAME_WIDTH; x += dashLength + gapLength) {
            graphics.beginPath();
            graphics.moveTo(x, DROP_LINE_Y);
            graphics.lineTo(x + dashLength, DROP_LINE_Y);
            graphics.strokePath();
        }

        // 위험선 텍스트
        this.add.text(10, DROP_LINE_Y - 20, 'DANGER', {
            fontFamily: 'Pretendard',
            fontSize: '14px',
            color: '#ff8e8b',
            fontWeight: 'bold'
        }).setAlpha(0.7);
    }

    setupInputs() {
        // 마우스/터치 이동
        this.input.on('pointermove', (pointer) => {
            if (isGameOver) return;
            // X 좌표를 게임 영역 내로 제한
            const margin = BALLS[nextBallLevel - 1].radius;
            lastPointerX = Phaser.Math.Clamp(pointer.x, margin, GAME_WIDTH - margin);
        });

        // 클릭/터치로 공 떨어뜨리기
        this.input.on('pointerdown', (pointer) => {
            if (isGameOver || !canDrop) return;
            // 오른쪽 클릭 무시
            if (pointer.rightButtonDown()) return;

            // X 좌표 갱신 (터치의 경우 move 없이 down만 발생할 수 있음)
            const margin = BALLS[nextBallLevel - 1].radius;
            lastPointerX = Phaser.Math.Clamp(pointer.x, margin, GAME_WIDTH - margin);
            
            this.dropBall();
        });

        // 오른쪽 클릭 메뉴 방지
        this.input.mouse.disableContextMenu();
    }

    updatePreviewPosition() {
        if (!this.previewBall || !this.previewLine) return;

        if (canDrop && !isGameOver) {
            this.previewBall.setVisible(true);
            this.previewLine.setVisible(true);
            
            // X 위치 부드럽게 이동 (선택적, 바로 따라가게 하려면 lerp 없이 설정)
            this.previewBall.x = lastPointerX;
            this.previewBall.y = DROP_LINE_Y / 2; // 위험선 위쪽 고정
            
            // 공 크기 업데이트
            const ballData = BALLS[nextBallLevel - 1];
            this.previewBall.setTexture(ballData.key);
            this.previewBall.setDisplaySize(ballData.radius * 2, ballData.radius * 2);

            // 가이드라인 위치 업데이트
            this.previewLine.setTo(lastPointerX, DROP_LINE_Y / 2, lastPointerX, GAME_HEIGHT);
        } else {
            this.previewBall.setVisible(false);
            this.previewLine.setVisible(false);
        }
    }

    getRandomDropLevel() {
        // 1~5단계 중 랜덤 (확률 조정 가능)
        // 여기서는 동일 확률로 1~5 제공
        return Phaser.Math.Between(1, 5);
    }

    setNextBall() {
        nextBallLevel = this.getRandomDropLevel();
        
        // HTML UI 업데이트
        const nextImg = document.getElementById('next-ball-img');
        const placeholder = document.getElementById('next-ball-placeholder');
        
        const ballData = BALLS[nextBallLevel - 1];
        nextImg.src = ballData.image;
        nextImg.style.display = 'block';
        placeholder.style.display = 'none';
    }

    dropBall() {
        canDrop = false;
        
        // 현재 레벨 공 생성
        const ballData = BALLS[nextBallLevel - 1];
        
        // y 위치는 위험선 살짝 위
        const yPos = DROP_LINE_Y / 2;
        
        this.createBall(lastPointerX, yPos, nextBallLevel);
        
        // 사운드 재생 (나중에 주석 해제)
        // this.sound.play('dropSound', { volume: 0.5 });

        // 다음 공 준비
        this.setNextBall();

        // 쿨타임 적용
        this.time.delayedCall(COOLDOWN_TIME, () => {
            canDrop = true;
            // 쿨타임 후 다음 공의 X 한계 재계산
            const margin = BALLS[nextBallLevel - 1].radius;
            lastPointerX = Phaser.Math.Clamp(lastPointerX, margin, GAME_WIDTH - margin);
        });
    }

    createBall(x, y, level) {
        const ballData = BALLS[level - 1];
        
        // Matter.js 물리 객체로 이미지 생성
        const ball = this.matter.add.image(x, y, ballData.key);
        
        // 물리 속성 설정 (원형 충돌체)
        ball.setCircle(ballData.radius);
        ball.setBounce(0.3); // 튕기는 정도
        ball.setFriction(0.005);
        ball.setDensity(0.001 * (level)); // 무거울수록 밀도가 높게
        
        // 이미지 크기 맞추기 (원본 이미지가 큰 경우)
        ball.setDisplaySize(ballData.radius * 2, ballData.radius * 2);

        // 부드러운 그림자 효과 느낌을 위해 틴트나 효과를 줄 수 있지만, 
        // 이미지 자체를 돋보이게 놔둠.
        
        // 데이터 저장
        ball.setData('level', level);
        ball.setData('isMerging', false);
        ball.setData('spawnTime', this.time.now); // 생성 시간 (게임오버 체크용)
        
        activeBalls.push(ball);
        return ball;
    }

    setupCollisions() {
        this.matter.world.on('collisionstart', (event) => {
            if (isGameOver) return;

            const pairs = event.pairs;

            for (let i = 0; i < pairs.length; i++) {
                const bodyA = pairs[i].bodyA;
                const bodyB = pairs[i].bodyB;

                // 둘 다 gameObject를 가지고 있는지 확인
                if (bodyA.gameObject && bodyB.gameObject) {
                    const objA = bodyA.gameObject;
                    const objB = bodyB.gameObject;

                    // 둘 다 우리 공인지 확인
                    if (objA.getData && objB.getData && objA.getData('level') && objB.getData('level')) {
                        const levelA = objA.getData('level');
                        const levelB = objB.getData('level');

                        // 레벨이 같고, 합체 중이 아니면
                        if (levelA === levelB && !objA.getData('isMerging') && !objB.getData('isMerging')) {
                            // 중복 방지 플래그
                            objA.setData('isMerging', true);
                            objB.setData('isMerging', true);
                            
                            this.mergeBalls(objA, objB, levelA);
                        }
                    }
                }
            }
        });
    }

    mergeBalls(ballA, ballB, level) {
        // 충돌 중간 위치 계산
        const midX = (ballA.x + ballB.x) / 2;
        const midY = (ballA.y + ballB.y) / 2;

        // 배열에서 제거
        activeBalls = activeBalls.filter(b => b !== ballA && b !== ballB);

        // 물리 세계에서 객체 제거
        ballA.destroy();
        ballB.destroy();

        // 파티클 효과
        this.createMergeParticles(midX, midY, level);

        // 점수 추가
        this.addScore(level);

        // 사운드 재생 (나중에 주석 해제)
        // this.sound.play('mergeSound', { volume: 0.6, pitch: 1 - (level * 0.05) });

        // 다음 단계 공 생성 (11단계 미만일 때)
        if (level < 11) {
            this.createBall(midX, midY, level + 1);
        } else {
            // 11단계 합체 시 (최종 보너스) 수박 2개가 사라지고 보너스만 획득하는 로직
            // 또는 11단계는 안 합쳐지게 하려면 이전 collision 로직에서 levelA < 11 조건을 추가하면 됨.
            // 요구사항: "마지막 11단계 공은 더 이상 다음 단계로 합쳐지지 않는다." 
            // 위 조건에 의해 11단계는 계속 남아있어야 하므로, 여기서는 합체 자체를 시키지 않게 수정해야 함.
            // (collision 로직에서 이미 방지하거나 여기서 재생성)
            
            // 아, 규칙 4번 "11단계 공은 더 이상 다음 단계로 합쳐지지 않는다" 에 따라
            // 사실 collision 자체를 막는게 맞음. 
            // 아래에 예외 처리 추가함 (합체된 걸로 넘어오면 다시 11단계를 1개 만듦)
            this.createBall(midX, midY, 11);
            // 최종 보너스 점수만 주고 1개로 남김 (공간 확보 X)
        }
    }

    createMergeParticles(x, y, level) {
        // 파티클 색상: 단계별로 조금씩 다르게 주거나 통일
        const colors = [0xff8e8b, 0x79d2c2, 0xffd166, 0xef476f, 0x118ab2];
        const color = colors[level % colors.length];

        const emitter = this.add.particles(x, y, 'particle_base', {
            speed: { min: 50, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 1.5, end: 0 },
            tint: color,
            lifespan: 600,
            gravityY: 300,
            quantity: 15 + level * 2, // 단계가 높을수록 많이
            blendMode: 'ADD'
        });

        // 효과 끝난 후 이미터 제거
        this.time.delayedCall(1000, () => {
            emitter.destroy();
        });
    }

    addScore(level) {
        const scoreToAdd = BALLS[level - 1].score;
        currentScore += scoreToAdd;
        
        // UI 업데이트
        this.updateScoreUI();

        // 화면 팝업 텍스트 (옵션)
        const scoreText = this.add.text(lastPointerX, DROP_LINE_Y, `+${scoreToAdd}`, {
            fontFamily: 'Pretendard',
            fontSize: '24px',
            color: '#ff8e8b',
            stroke: '#ffffff',
            strokeThickness: 4,
            fontWeight: 'bold'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: scoreText,
            y: scoreText.y - 50,
            alpha: 0,
            duration: 800,
            ease: 'Cubic.easeOut',
            onComplete: () => scoreText.destroy()
        });
    }

    updateScoreUI() {
        document.getElementById('current-score').innerText = currentScore;
        
        if (currentScore > bestScore) {
            bestScore = currentScore;
            localStorage.setItem('qplayMergeBestScore', bestScore);
        }
        document.getElementById('best-score').innerText = bestScore;
    }

    checkGameOver(time) {
        // 공이 안정화되었는지 판단하는 임계값
        const velocityThreshold = 0.5; 
        
        for (let i = 0; i < activeBalls.length; i++) {
            const ball = activeBalls[i];
            
            // 생성된 지 1.5초가 지난 공만 검사 (떨어지는 중인 공 제외)
            if (time - ball.getData('spawnTime') > 1500) {
                
                // 공의 상단 가장자리가 위험선을 넘었는지 확인
                // (ball.y - radius가 공의 맨 위쪽)
                const ballTop = ball.y - BALLS[ball.getData('level') - 1].radius;
                
                if (ballTop < DROP_LINE_Y) {
                    // 거의 멈춰있는 상태인지 확인 (속도로 판단)
                    if (Math.abs(ball.body.velocity.y) < velocityThreshold && Math.abs(ball.body.velocity.x) < velocityThreshold) {
                        
                        // 이미 카운팅 중인지 확인
                        if (!ball.getData('dangerStartTime')) {
                            ball.setData('dangerStartTime', time);
                        } else {
                            // 위험선 위에 1.5초 이상 머물렀다면 게임 오버
                            if (time - ball.getData('dangerStartTime') > 1500) {
                                this.endGame();
                                return; // 반복문 즉시 탈출
                            }
                        }
                    } else {
                        // 움직이고 있다면 카운터 초기화
                        ball.setData('dangerStartTime', null);
                    }
                } else {
                    // 위험선 아래로 내려갔다면 카운터 초기화
                    ball.setData('dangerStartTime', null);
                }
            }
        }
    }

    endGame() {
        if (isGameOver) return;
        isGameOver = true;

        // 물리 엔진 정지
        this.matter.world.pause();

        // 사운드 (주석)
        // this.sound.play('gameoverSound');

        // UI 모달 띄우기
        const modal = document.getElementById('game-over-modal');
        const modalScore = document.getElementById('modal-score');
        
        modalScore.innerText = currentScore;
        modal.classList.remove('hidden');
    }
}

// ==========================================
// 4. Phaser 설정 및 초기화
// ==========================================

const config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    scale: {
        mode: Phaser.Scale.FIT, // 부모 컨테이너(게임영역)에 맞게 비율 유지하며 축소
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    backgroundColor: '#eef7fd', // 투명하게 하려면 null
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 1.5 },
            debug: false // 릴리즈 시 false
        }
    },
    scene: [MainScene]
};

// 게임 인스턴스 생성
let game = new Phaser.Game(config);

// ==========================================
// 5. HTML 버튼 이벤트 리스너
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const restartBtn = document.getElementById('restart-btn');
    const modalRestartBtn = document.getElementById('modal-restart-btn');
    const modal = document.getElementById('game-over-modal');

    // UI에 최고 점수 초기화
    document.getElementById('best-score').innerText = localStorage.getItem('qplayMergeBestScore') || 0;

    // 다시 시작 함수
    const restartGame = () => {
        modal.classList.add('hidden');
        
        // 현재 활성화된 씬 찾아서 재시작
        const scene = game.scene.keys.MainScene;
        scene.scene.restart();
    };

    restartBtn.addEventListener('click', restartGame);
    modalRestartBtn.addEventListener('click', restartGame);
});