const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

/* =======================
   CLOUD STORAGE
======================= */
const Storage = {
    KEY: 'tg_2048_state_v1',

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

/* =======================
   GAME 2048
======================= */
class Game2048 {
    constructor() {
        this.size = 4;
        this.grid = [];
        this.score = 0;
        this.bestScore = 0;
        this.tileId = 0;

        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');

        const width = document.getElementById('game-container').clientWidth;
        this.gap = 10;
        this.cell = (width - 5 * this.gap) / 4;

        this.touchX = 0;
        this.touchY = 0;

        document.getElementById('restart-btn').onclick = () => this.restart();
        document.getElementById('retry-btn').onclick = () => this.restart();

        this.init();
    }

    async init() {
        const saved = await Storage.load();

        if (saved) {
            this.bestScore = saved.bestScore || 0;
            this.bestScoreEl.innerText = this.bestScore;

            if (!saved.isGameOver && saved.grid) {
                this.restore(saved);
                this.setupInput();
                return;
            }
        }

        this.bestScoreEl.innerText = this.bestScore;
        this.setupInput();
        this.restart();
    }

    restart() {
        this.grid = Array.from({ length: 4 }, () => Array(4).fill(null));
        this.score = 0;
        this.tileId = 0;
        this.scoreEl.innerText = 0;
        this.tileContainer.innerHTML = '';
        this.gameOverScreen.style.display = 'none';

        this.addTile();
        this.addTile();
        this.draw();
        this.save(false);
    }

    restore(state) {
        this.grid = state.grid.map(row =>
            row.map(v => v ? {
                value: v,
                id: this.tileId++,
                merged: false,
                isNew: false
            } : null)
        );

        this.score = state.score;
        this.scoreEl.innerText = this.score;
        this.tileContainer.innerHTML = '';
        this.gameOverScreen.style.display = 'none';

        this.draw();
    }

    addTile() {
        const empty = [];
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++)
                if (!this.grid[r][c]) empty.push({ r, c });

        if (!empty.length) return;

        const { r, c } = empty[Math.floor(Math.random() * empty.length)];
        this.grid[r][c] = {
            value: Math.random() < 0.9 ? 2 : 4,
            id: this.tileId++,
            merged: false,
            isNew: true
        };
    }

    draw() {
        requestAnimationFrame(() => {
            const alive = new Set();

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    const t = this.grid[r][c];
                    if (!t) continue;
                    alive.add(t.id);
                    this.drawTile(t, r, c);
                    t.merged = false;
                    t.isNew = false;
                }
            }

            document.querySelectorAll('.tile').forEach(el => {
                if (!alive.has(+el.dataset.id)) el.remove();
            });
        });
    }

    drawTile(tile, r, c) {
        let el = document.querySelector(`.tile[data-id="${tile.id}"]`);
        const x = this.gap + c * (this.cell + this.gap);
        const y = this.gap + r * (this.cell + this.gap);

        if (!el) {
            el = document.createElement('div');
            el.className = `tile tile-${tile.value}`;
            el.dataset.id = tile.id;
            el.innerHTML = `<div class="tile-inner">${tile.value}</div>`;
            el.style.width = el.style.height = this.cell + 'px';
            el.style.transform = `translate(${x}px, ${y}px)`;
            if (tile.isNew) el.classList.add('tile-new');
            this.tileContainer.appendChild(el);
        } else {
            el.className = `tile tile-${tile.value}`;
            el.querySelector('.tile-inner').innerText = tile.value;
            el.style.transform = `translate(${x}px, ${y}px)`;
            if (tile.merged) el.classList.add('tile-merged');
        }
    }

    move(key) {
        const dir = {
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0]
        }[key];
        if (!dir) return;

        let moved = false;
        const rows = [...Array(4).keys()];
        const cols = [...Array(4).keys()];
        if (dir[0] === 1) cols.reverse();
        if (dir[1] === 1) rows.reverse();

        rows.forEach(r => cols.forEach(c => {
            const t = this.grid[r][c];
            if (!t) return;

            let nr = r, nc = c;

            while (true) {
                const rr = nr + dir[1];
                const cc = nc + dir[0];
                if (rr < 0 || rr > 3 || cc < 0 || cc > 3) break;

                const n = this.grid[rr][cc];
                if (!n) {
                    nr = rr; nc = cc;
                } else if (n.value === t.value && !n.merged) {
                    n.value *= 2;
                    n.merged = true;
                    this.score += n.value;
                    this.grid[r][c] = null;
                    moved = true;
                    return;
                } else break;
            }

            if ((nr !== r || nc !== c) && this.grid[r][c]) {
                this.grid[nr][nc] = t;
                this.grid[r][c] = null;
                moved = true;
            }
        }));

        if (!moved) return;

        this.updateScore();
        this.addTile();
        this.draw();

        const over = this.isGameOver();
        if (over) this.gameOverScreen.style.display = 'flex';
        this.save(over);
    }

    updateScore() {
        this.scoreEl.innerText = this.score;
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
        }
    }

    save(isGameOver) {
        Storage.save({
            bestScore: this.bestScore,
            score: this.score,
            grid: this.grid.map(r => r.map(t => t ? t.value : 0)),
            isGameOver
        });
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

    setupInput() {
        window.addEventListener('keydown', e => {
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                this.move(e.key);
            }
        });

        const c = document.getElementById('game-container');

        c.addEventListener('touchstart', e => {
            this.touchX = e.touches[0].clientX;
            this.touchY = e.touches[0].clientY;
        }, { passive: false });

        c.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

        c.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - this.touchX;
            const dy = e.changedTouches[0].clientY - this.touchY;

            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30)
                this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
            else if (Math.abs(dy) > 30)
                this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
        }, { passive: false });
    }
}

new Game2048();
