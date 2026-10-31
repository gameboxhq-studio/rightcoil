/**
 * 右旋壳 Rightcoil — Phaser 3 竖屏路径谜题
 * 蜗牛撞墙/石头永远右转；玩家只放/撤石头；吃光叶子通关。
 */
(() => {
  const W = 360;
  const H = 640;
  const COLS = 6;
  const ROWS = 8;
  const CELL = 48;
  const BOARD_X = (W - COLS * CELL) / 2; // 36
  const BOARD_Y = 96;
  const MAX_STEPS = 64;
  const TICK_MS = 280;

  const C = {
    shell: 0xf4a261,
    leaf: 0x2a9d8f,
    stone: 0x4a5568,
    floor: 0xe9d8a6,
    wall: 0x3d2914,
    void: 0x1a120b,
    ui: 0xe9d8a6,
    dim: 0x8a7a68,
  };

  // dirs: 0=E, 1=S, 2=W, 3=N
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const DIR_FRAME = [0, 1, 2, 3]; // snail.png frames: E S W N

  /**
   * Level maps: # wall, . floor, S start, L leaf, R fixed rock
   * startDir: 0–3
   */
  const LEVELS = [
    {
      id: 1,
      stoneLimit: 0,
      startDir: 0,
      map: [
        '######',
        '#S..L#',
        '#....#',
        '#....#',
        '#....#',
        '#....#',
        '#L...#',
        '######',
      ],
      // 教学：右贴墙走一圈吃两叶，无需石头
    },
    {
      id: 2,
      stoneLimit: 1,
      startDir: 0,
      map: [
        '######',
        '#S...#',
        '#....#',
        '#..L.#',
        '#L...#',
        '#...L#',
        '#....#',
        '######',
      ],
      // 意图石 (1,2)：挡住回程左列，逼右转进内格吃第三叶
      hintStone: { x: 1, y: 2 },
    },
    {
      id: 3,
      stoneLimit: 1,
      startDir: 0,
      map: [
        '######',
        '#S...#',
        '#.#..#',
        '#L..L#',
        '#.#..#',
        '#L..L#',
        '#..R.#',
        '######',
      ],
      // 意图石 (4,6)：远处一石翻盘，串起四叶
      hintStone: { x: 4, y: 6 },
    },
  ];

  function parseLevel(level) {
    const walls = new Set();
    const leaves = new Set();
    const fixedRocks = new Set();
    let start = null;
    level.map.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        const key = x + ',' + y;
        if (ch === '#') walls.add(key);
        else if (ch === 'L') leaves.add(key);
        else if (ch === 'R') fixedRocks.add(key);
        else if (ch === 'S') start = { x, y };
      }
    });
    return { walls, leaves, fixedRocks, start, startDir: level.startDir, stoneLimit: level.stoneLimit };
  }

  class MainScene extends Phaser.Scene {
    constructor() {
      super('main');
    }

    preload() {
      this.load.spritesheet('snail', 'assets/snail.png', {
        frameWidth: 256,
        frameHeight: 256,
      });
      this.load.image('stone', 'assets/stone.png');
      this.load.image('leaf', 'assets/leaf.png');
      this.load.image('floor', 'assets/floor.png');
    }

    create() {
      this.levelIndex = 0;
      this.playerStones = new Set();
      this.phase = 'place'; // place | walk | win | fail
      this.steps = 0;
      this.walkTimer = null;
      this.seenStates = null;
      this.turnStreak = 0;
      this.overlay = null;

      this.cameras.main.setBackgroundColor(C.void);

      // layers
      this.boardLayer = this.add.container(0, 0);
      this.entityLayer = this.add.container(0, 0);
      this.uiLayer = this.add.container(0, 0);

      this.buildChrome();
      this.loadLevel(0);

      this.input.on('pointerdown', (pointer) => this.onTap(pointer));
    }

    buildChrome() {
      // top title strip
      const bar = this.add.rectangle(W / 2, 28, W - 16, 40, C.wall, 0.95).setStrokeStyle(2, 0x5a4030);
      this.uiLayer.add(bar);

      this.titleText = this.add
        .text(W / 2, 28, '右旋壳', {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '18px',
          color: '#F4A261',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      this.uiLayer.add(this.titleText);

      this.infoText = this.add
        .text(W / 2, 62, '', {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '13px',
          color: '#E9D8A6',
          align: 'center',
        })
        .setOrigin(0.5);
      this.uiLayer.add(this.infoText);

      // start button
      const by = BOARD_Y + ROWS * CELL + 36;
      this.btnBg = this.add
        .rectangle(W / 2, by, 160, 44, C.shell, 1)
        .setStrokeStyle(2, 0xc47a3a)
        .setInteractive({ useHandCursor: true });
      this.btnLabel = this.add
        .text(W / 2, by, '出发', {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '20px',
          color: '#1A120B',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      this.uiLayer.add(this.btnBg);
      this.uiLayer.add(this.btnLabel);
      this.btnBg.on('pointerdown', () => this.onButton());

      this.statusText = this.add
        .text(W / 2, by + 40, '', {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '12px',
          color: '#8a7a68',
          align: 'center',
        })
        .setOrigin(0.5);
      this.uiLayer.add(this.statusText);
    }

    cellKey(x, y) {
      return x + ',' + y;
    }

    cellCenter(x, y) {
      return {
        x: BOARD_X + x * CELL + CELL / 2,
        y: BOARD_Y + y * CELL + CELL / 2,
      };
    }

    loadLevel(index) {
      this.clearWalk();
      this.hideOverlay();
      this.levelIndex = index;
      this.levelDef = LEVELS[index];
      this.parsed = parseLevel(this.levelDef);
      this.playerStones = new Set();
      this.remainingLeaves = new Set(this.parsed.leaves);
      this.phase = 'place';
      this.steps = 0;
      this.snailPos = { ...this.parsed.start };
      this.snailDir = this.parsed.startDir;
      this.redrawBoard();
      this.updateInfo();
      this.setButton('出发', true);
      this.statusText.setText(
        this.levelDef.stoneLimit === 0
          ? '本关无需石头 · 直接出发'
          : '点空地放/撤石头（上限 ' + this.levelDef.stoneLimit + '）'
      );
    }

    redrawBoard() {
      this.boardLayer.removeAll(true);
      this.entityLayer.removeAll(true);
      this.leafSprites = new Map();
      this.stoneSprites = new Map();

      // floor + walls
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const key = this.cellKey(x, y);
          const cx = BOARD_X + x * CELL + CELL / 2;
          const cy = BOARD_Y + y * CELL + CELL / 2;
          if (this.parsed.walls.has(key)) {
            const wall = this.add.rectangle(cx, cy, CELL - 1, CELL - 1, C.wall, 1);
            this.boardLayer.add(wall);
          } else {
            const floor = this.add
              .image(cx, cy, 'floor')
              .setDisplaySize(CELL - 2, CELL - 2);
            this.boardLayer.add(floor);
          }
        }
      }

      // board frame
      const frame = this.add
        .rectangle(
          BOARD_X + (COLS * CELL) / 2,
          BOARD_Y + (ROWS * CELL) / 2,
          COLS * CELL + 4,
          ROWS * CELL + 4,
          C.void,
          0
        )
        .setStrokeStyle(3, C.shell, 0.55);
      this.boardLayer.add(frame);

      // leaves
      this.remainingLeaves.forEach((key) => {
        const [x, y] = key.split(',').map(Number);
        const { x: px, y: py } = this.cellCenter(x, y);
        const spr = this.add.image(px, py, 'leaf').setDisplaySize(CELL * 0.72, CELL * 0.72);
        this.entityLayer.add(spr);
        this.leafSprites.set(key, spr);
      });

      // fixed rocks
      this.parsed.fixedRocks.forEach((key) => {
        const [x, y] = key.split(',').map(Number);
        const { x: px, y: py } = this.cellCenter(x, y);
        const spr = this.add.image(px, py, 'stone').setDisplaySize(CELL * 0.8, CELL * 0.8);
        spr.setTint(0xc8d0dc);
        this.entityLayer.add(spr);
        this.stoneSprites.set(key, spr);
      });

      // player stones
      this.playerStones.forEach((key) => this.spawnPlayerStoneSprite(key));

      // snail
      const { x: sx, y: sy } = this.cellCenter(this.snailPos.x, this.snailPos.y);
      this.snail = this.add
        .sprite(sx, sy, 'snail', DIR_FRAME[this.snailDir])
        .setDisplaySize(CELL * 0.88, CELL * 0.88);
      this.entityLayer.add(this.snail);
    }

    spawnPlayerStoneSprite(key) {
      const [x, y] = key.split(',').map(Number);
      const { x: px, y: py } = this.cellCenter(x, y);
      const spr = this.add.image(px, py, 'stone').setDisplaySize(CELL * 0.8, CELL * 0.8);
      this.entityLayer.add(spr);
      this.stoneSprites.set(key, spr);
    }

    updateInfo() {
      const n = this.levelIndex + 1;
      const used = this.playerStones.size;
      const lim = this.levelDef.stoneLimit;
      const left = this.remainingLeaves.size;
      this.infoText.setText(
        '关卡 ' + n + ' / ' + LEVELS.length + '　石 ' + used + '/' + lim + '　叶 ' + left + '　步 ' + this.steps + '/' + MAX_STEPS
      );
    }

    setButton(label, enabled) {
      this.btnLabel.setText(label);
      this.btnBg.setFillStyle(enabled ? C.shell : C.stone, 1);
      this.btnEnabled = enabled;
    }

    onButton() {
      if (!this.btnEnabled) return;
      if (this.phase === 'place') {
        this.startWalk();
      } else if (this.phase === 'fail' || this.phase === 'win') {
        // handled by overlay buttons mostly; keep as fallback
        if (this.phase === 'fail') this.loadLevel(this.levelIndex);
        else this.nextOrReplay();
      }
    }

    nextOrReplay() {
      if (this.levelIndex < LEVELS.length - 1) this.loadLevel(this.levelIndex + 1);
      else this.loadLevel(0);
    }

    onTap(pointer) {
      if (this.phase !== 'place') return;
      if (this.levelDef.stoneLimit <= 0) return;

      const gx = Math.floor((pointer.x - BOARD_X) / CELL);
      const gy = Math.floor((pointer.y - BOARD_Y) / CELL);
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return;

      const key = this.cellKey(gx, gy);
      if (this.parsed.walls.has(key)) return;
      if (this.parsed.fixedRocks.has(key)) return;
      if (this.parsed.leaves.has(key)) return;
      if (gx === this.parsed.start.x && gy === this.parsed.start.y) return;

      if (this.playerStones.has(key)) {
        this.playerStones.delete(key);
        const spr = this.stoneSprites.get(key);
        if (spr) {
          spr.destroy();
          this.stoneSprites.delete(key);
        }
      } else {
        if (this.playerStones.size >= this.levelDef.stoneLimit) {
          this.statusText.setText('石头已达上限');
          return;
        }
        this.playerStones.add(key);
        this.spawnPlayerStoneSprite(key);
      }
      this.updateInfo();
      this.statusText.setText('石 ' + this.playerStones.size + '/' + this.levelDef.stoneLimit + ' · 点「出发」开始');
    }

    isBlocked(x, y) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
      const key = this.cellKey(x, y);
      if (this.parsed.walls.has(key)) return true;
      if (this.parsed.fixedRocks.has(key)) return true;
      if (this.playerStones.has(key)) return true;
      return false;
    }

    startWalk() {
      this.phase = 'walk';
      this.steps = 0;
      this.turnStreak = 0;
      this.seenStates = new Set();
      this.remainingLeaves = new Set(this.parsed.leaves);
      this.snailPos = { ...this.parsed.start };
      this.snailDir = this.parsed.startDir;
      this.syncSnailSprite();
      // re-show all leaves
      this.leafSprites.forEach((spr) => spr.setVisible(true));
      this.setButton('行走中…', false);
      this.statusText.setText('蜗牛出发了');
      this.updateInfo();

      // eat if start on leaf (shouldn't)
      this.tryEat();

      this.walkTimer = this.time.addEvent({
        delay: TICK_MS,
        loop: true,
        callback: () => this.tickWalk(),
      });
    }

    clearWalk() {
      if (this.walkTimer) {
        this.walkTimer.remove(false);
        this.walkTimer = null;
      }
    }

    syncSnailSprite() {
      const { x, y } = this.cellCenter(this.snailPos.x, this.snailPos.y);
      this.snail.setPosition(x, y);
      this.snail.setFrame(DIR_FRAME[this.snailDir]);
    }

    tryEat() {
      const key = this.cellKey(this.snailPos.x, this.snailPos.y);
      if (this.remainingLeaves.has(key)) {
        this.remainingLeaves.delete(key);
        const spr = this.leafSprites.get(key);
        if (spr) spr.setVisible(false);
        return true;
      }
      return false;
    }

    tickWalk() {
      if (this.phase !== 'walk') return;

      if (this.remainingLeaves.size === 0) {
        this.onWin();
        return;
      }

      const state = this.snailPos.x + ',' + this.snailPos.y + ',' + this.snailDir;
      if (this.seenStates.has(state)) {
        this.onFail('陷入循环');
        return;
      }
      this.seenStates.add(state);

      if (this.steps >= MAX_STEPS) {
        this.onFail('步数用尽');
        return;
      }

      const nx = this.snailPos.x + DX[this.snailDir];
      const ny = this.snailPos.y + DY[this.snailDir];

      if (this.isBlocked(nx, ny)) {
        this.snailDir = (this.snailDir + 1) % 4;
        this.turnStreak += 1;
        this.steps += 1;
        this.syncSnailSprite();
        this.updateInfo();
        if (this.turnStreak >= 4) {
          this.onFail('无路可走');
          return;
        }
      } else {
        this.snailPos = { x: nx, y: ny };
        this.turnStreak = 0;
        this.steps += 1;
        this.syncSnailSprite();
        this.tryEat();
        this.updateInfo();
        if (this.remainingLeaves.size === 0) {
          this.onWin();
        }
      }
    }

    onWin() {
      this.clearWalk();
      this.phase = 'win';
      const last = this.levelIndex >= LEVELS.length - 1;
      this.setButton(last ? '再玩' : '下一关', true);
      this.statusText.setText('通关！用了 ' + this.steps + ' 步');
      this.showOverlay(
        '通关！',
        '叶子吃光 · ' + this.steps + ' 步',
        last ? '再玩' : '下一关',
        () => this.nextOrReplay()
      );
    }

    onFail(reason) {
      this.clearWalk();
      this.phase = 'fail';
      this.setButton('再来', true);
      this.statusText.setText('失败：' + reason);
      this.showOverlay('失败', reason, '再来', () => this.loadLevel(this.levelIndex));
    }

    showOverlay(title, sub, btnText, onClick) {
      this.hideOverlay();
      const g = this.add.container(0, 0);
      const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55);
      bg.setInteractive();
      const panel = this.add
        .rectangle(W / 2, H / 2 - 20, 260, 180, C.wall, 0.98)
        .setStrokeStyle(3, C.shell);
      const t = this.add
        .text(W / 2, H / 2 - 70, title, {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '28px',
          color: '#F4A261',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const s = this.add
        .text(W / 2, H / 2 - 30, sub, {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '14px',
          color: '#E9D8A6',
          align: 'center',
        })
        .setOrigin(0.5);
      const b = this.add
        .rectangle(W / 2, H / 2 + 30, 140, 40, C.shell, 1)
        .setStrokeStyle(2, 0xc47a3a)
        .setInteractive({ useHandCursor: true });
      const bl = this.add
        .text(W / 2, H / 2 + 30, btnText, {
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: '18px',
          color: '#1A120B',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      b.on('pointerdown', () => {
        this.hideOverlay();
        onClick();
      });
      g.add([bg, panel, t, s, b, bl]);
      this.overlay = g;
    }

    hideOverlay() {
      if (this.overlay) {
        this.overlay.destroy(true);
        this.overlay = null;
      }
    }
  }

  const config = {
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent: 'game-container',
    backgroundColor: '#1A120B',
    scene: MainScene,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  };

  // eslint-disable-next-line no-new
  new Phaser.Game(config);
})();
