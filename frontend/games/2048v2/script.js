const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ================== STORAGE ==================
const Storage = {
    KEY: '2048_state_v1',

    async load() {
        return new Promise((resolve) => {
            try {
                tg.CloudStorage.getItem(this.KEY, (err, value) => {
                    if (!err && value) {
                        resolve(JSON.parse(value));
                    } else {
                        const local = localStorage.getItem(this.KEY);
                        resolve(local ? JSON.parse(local) : null);
                    }
                });
            } catch {
                const local = localStorage.getItem(this.KEY);
                resolve(local ? JSON.parse(local) : null);
            }
        });
    },

    save(state) {
        const data = JSON.stringify(state);
        localStorage.setItem(this.KEY, data);
        try {
            tg.CloudStorage.setItem(this.KEY, data);
        } catch {}
    }
};

// ================== GAME ==================
class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.score = 0;
        this.bestScore = 0;
        this.grid = [];
        this.tileIdCounter = 0;

        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');

        const containerWidth = document.getElementById('game-container').clientWidth;
        this.gap = 10;
        this.cellSize = (containerWidth - 5 * this.gap) / 4;

        this.touchStartX = 0;
        this.touchStartY = 0;

        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
        document.getElementById('retry-btn').addEventListener('click', () => this.restart());

        this.init();
    }

    // ================== INIT / RESTORE ==================
    async init() {
        const saved = await Storage.load();

        if (saved) {
            this.bestScore = saved.bestScore || 0;
            this.bestScoreEl.innerText = this.bestScore;

            if (!saved.isGameOver && saved.grid) {
                this.restoreState(saved);
                this.setupInput();
                return;
            }
        }

        this.bestScoreEl.innerText = this.bestScore;
        this.setupInput();
        this.restart();
    }

    restoreState(state) {
        this.grid = state.grid.map(row =>
            row.map(v => v ? {
                value: v,
                id: this.tileIdCounter++,
                merged: false,
                isNew: false
            } : null)
        );

        this.score = state.score || 0;
        this.scoreEl.innerText = this.score;
        this.tileContainer.innerHTML = '';
        this.gameOverScreen.style.display = 'none';

        this.draw();
    }

    // ================== GAME FLOW ==================
    restart() {
        this.grid = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
        this.score = 0;
        this.updateScore(0);
        this.gameOverScreen.style.display = 'none';
        this.tileContainer.innerHTML = '';
        this.tileIdCounter = 0;

        this.addRandomTile();
        this.addRandomTile();
        this.draw();
        this.saveState(false);
    }

    saveState(isGameOver = false) {
        const gridValues = this.grid.map(row =>
            row.map(t => t ? t.value : 0)
        );

        Storage.save({
            bestScore: this.bestScore,
            score: this.score,
            grid: gridValues,
            isGameOver
        });
    }

    // ================== LOGIC ==================
    addRandomTile() {
        const empty = [];
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++)
                if (!this.grid[r][c]) empty.push({ r, c });

        if (empty.length) {
            const { r, c } = empty[Math.floor(Math.random() * empty.length)];
            this.grid[r][c] = {
                value: Math.random() < 0.9 ? 2 : 4,
                id: this.tileIdCounter++,
                isNew: true,
                merged: false
            };
        }
    }

    // ================== RENDER ==================
    draw() {
        requestAnimationFrame(() => {
            const alive = new Set();

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    const tile = this.grid[r][c];
                    if (tile) {
                        alive.add(tile.id);
                        this.drawTile(tile, r, c);
                        tile.isNew = false;
                        tile.merged = false;
                    }
                }
            }

            document.querySelectorAll('.tile').forEach(el => {
                if (!alive.has(+el.dataset.id)) el.remove();
            });
        });
    }

    drawTile(tile, r, c) {
        let el = document.querySelector(`.tile[data-id="${tile.id}"]`);
        const x = this.gap + c * (this.cellSize + this.gap);
        const y = this.gap + r * (this.cellSize + this.gap);
        const transform = `translate(${x}px, ${y}px)`;

        if (!el) {
            el = document.createElement('div');
            el.dataset.id = tile.id;
            el.className = `tile tile-${tile.value}`;
            el.style.width = el.style.height = this.cellSize + 'px';
            el.style.transform = transform;

            const inner = document.createElement('div');
            inner.className = 'tile-inner';
            inner.innerText = tile.value;
            el.appendChild(inner);

            if (tile.isNew) el.classList.add('tile-new');
            this.tileContainer.appendChild(el);
        } else {
            el.style.transform = transform;
            el.className = `tile tile-${tile.value}`;
            el.firstChild.innerText = tile.value;
            if (tile.merged) el.classList.add('tile-merged');
        }
    }

    // ================== MOVE ==================
    move(dir) {
        const vectors = {
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 }
        };

        const vector = vectors[dir];
        if (!vector) return;

        let moved = false;
        const rows = [0,1,2,3];
        const cols = [0,1,2,3];
        if (vector.x === 1) cols.reverse();
        if (vector.y === 1) rows.reverse();

        this.grid.forEach(r => r.forEach(t => t && (t.merged = false)));

        rows.forEach(r => {
            cols.forEach(c => {
                const tile = this.grid[r][c];
                if (!tile) return;

                let nr = r, nc = c;
                while (true) {
                    const tr = nr + vector.y;
                    const tc = nc + vector.x;
                    if (tr < 0 || tr > 3 || tc < 0 || tc > 3) break;

                    const target = this.grid[tr][tc];
                    if (!target) {
                        nr = tr; nc = tc;
                    } else if (target.value === tile.value && !target.merged) {
                        target.value *= 2;
                        target.merged = true;
                        this.score += target.value;
                        this.grid[r][c] = null;
                        moved = true;
                        return;
                    } else break;
                }

                if ((nr !== r || nc !== c) && this.grid[r][c]) {
                    this.grid[nr][nc] = tile;
                    this.grid[r][c] = null;
                    moved = true;
                }
            });
        });

        if (moved) {
            this.updateScore(this.score);
            this.addRandomTile();
            this.draw();

            const over = this.isGameOver();
            if (over) setTimeout(() => this.gameOverScreen.style.display = 'flex', 500);

            this.saveState(over);
        }
    }

    updateScore(s) {
        this.score = s;
        this.scoreEl.innerText = s;

        if (s > this.bestScore) {
            this.bestScore = s;
            this.bestScoreEl.innerText = s;
        }
    }

    isGameOver() {
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++)
                if (!this.grid[r][c]) return false;

        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++) {
                const v = this.grid[r][c].value;
                if (c < 3 && this.grid[r][c + 1].value === v) return false;
                if (r < 3 && this.grid[r + 1][c].value === v) return false;
            }

        return true;
    }

    // ================== INPUT ==================
    setupInput() {
        window.addEventListener('keydown', e => {
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                this.move(e.key);
            }
        });

        const c = document.getElementById('game-container');

        c.addEventListener('touchstart', e => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, { passive: false });

        c.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

        c.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - this.touchStartX;
            const dy = e.changedTouches[0].clientY - this.touchStartY;

            if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
                if (Math.abs(dx) > Math.abs(dy))
                    this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
                else
                    this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
            }
        }, { passive: false });
    }
}

new Game2048();
