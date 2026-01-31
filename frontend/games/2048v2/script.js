const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

/* ================= STORAGE ================= */

const Storage = {
    STATE_KEY: '2048_game_state_v1',
    BEST_KEY: '2048_best_score_v1',

    get(key) {
        return new Promise(resolve => {
            try {
                tg.CloudStorage.getItem(key, (err, value) => {
                    if (!err && value) resolve(JSON.parse(value));
                    else resolve(JSON.parse(localStorage.getItem(key)));
                });
            } catch {
                resolve(JSON.parse(localStorage.getItem(key)));
            }
        });
    },

    set(key, value) {
        const data = JSON.stringify(value);
        localStorage.setItem(key, data);
        try { tg.CloudStorage.setItem(key, data); } catch {}
    },

    async loadGame() {
        return await this.get(this.STATE_KEY);
    },

    saveGame(state) {
        this.set(this.STATE_KEY, state);
    },

    async getBestScore() {
        const data = await this.get(this.BEST_KEY);
        return data?.bestScore || 0;
    },

    setBestScore(score) {
        this.set(this.BEST_KEY, { bestScore: score });
    },

    clearGame() {
        localStorage.removeItem(this.STATE_KEY);
        try { tg.CloudStorage.removeItem(this.STATE_KEY); } catch {}
    }
};

/* ================= TILE ================= */

class Tile {
    constructor(container, value, x, y, size, gap) {
        this.container = container;
        this.value = value;
        this.x = x;
        this.y = y;
        this.size = size;
        this.gap = gap;
        this.mergedToRemove = false;

        this.element = document.createElement('div');
        this.element.className = `tile tile-${value}`;

        this.inner = document.createElement('div');
        this.inner.className = 'tile-inner';
        this.inner.textContent = value;

        this.element.appendChild(this.inner);
        this.updatePosition();
        this.element.classList.add('tile-new');
        this.container.appendChild(this.element);
    }

    updatePosition() {
        const x = this.x * (this.size + this.gap);
        const y = this.y * (this.size + this.gap);
        this.element.style.width = `${this.size}px`;
        this.element.style.height = `${this.size}px`;
        this.element.style.transform = `translate(${x}px, ${y}px)`;
    }

    updateValue(value) {
        this.value = value;
        this.inner.textContent = value;
        this.element.className = `tile tile-${value <= 2048 ? value : 'super'}`;
    }

    remove() {
        this.element.remove();
    }
}

/* ================= GAME ================= */

class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.tiles = [];
        this.score = 0;
        this.bestScore = 0;

        this.container = document.getElementById('game-container');
        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');
        this.gameMessage = document.getElementById('game-message');

        this.gap = 10;
        this.calculateSize();
        this.setupInput();

        document.getElementById('restart-btn').onclick = () => this.restart();
        document.getElementById('retry-btn').onclick = () => this.restart();

        this.init();
    }

    calculateSize() {
        const width = this.container.clientWidth;
        this.size = (width - this.gap * 5) / 4;
    }

    async init() {
        this.bestScore = await Storage.getBestScore();
        this.bestScoreEl.innerText = this.bestScore;

        const saved = await Storage.loadGame();
        if (saved?.tiles?.length) this.restoreState(saved);
        else this.restart();
    }

    restoreState(state) {
        this.tileContainer.innerHTML = '';
        this.tiles = [];
        this.score = state.score || 0;
        this.updateScore(this.score);

        state.tiles.forEach(t => {
            this.tiles.push(new Tile(
                this.tileContainer,
                t.value,
                t.x,
                t.y,
                this.size,
                this.gap
            ));
        });
    }

    saveState() {
        Storage.saveGame({
            score: this.score,
            bestScore: this.bestScore,
            tiles: this.tiles.map(t => ({
                x: t.x,
                y: t.y,
                value: t.value
            }))
        });
    }

    restart() {
        Storage.clearGame();
        this.tileContainer.innerHTML = '';
        this.tiles = [];
        this.score = 0;
        this.updateScore(0);
        this.gameOverScreen.classList.remove('active');
        this.addRandomTile();
        this.addRandomTile();
    }

    addRandomTile() {
        const empty = [];
        for (let x = 0; x < 4; x++)
            for (let y = 0; y < 4; y++)
                if (!this.tileAt(x, y)) empty.push({ x, y });

        if (!empty.length) return;
        const pos = empty[Math.floor(Math.random() * empty.length)];
        const value = Math.random() < 0.9 ? 2 : 4;
        this.tiles.push(new Tile(this.tileContainer, value, pos.x, pos.y, this.size, this.gap));
    }

    tileAt(x, y) {
        return this.tiles.find(t => t.x === x && t.y === y && !t.mergedToRemove);
    }

    updateScore(score) {
        this.score = score;
        this.scoreEl.innerText = score;

        if (score > this.bestScore) {
            this.bestScore = score;
            this.bestScoreEl.innerText = score;
            Storage.setBestScore(score);
        }

        this.saveState();
    }

    showGameOver() {
        this.gameMessage.innerHTML = `Игра окончена<br>Счет: ${this.score}`;
        this.gameOverScreen.classList.add('active');
        this.saveState();
    }

    move(dir) {
        const vector = {
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 }
        }[dir];

        let moved = false;
        const order = [...this.tiles].sort((a, b) =>
            vector.x ? (vector.x > 0 ? b.x - a.x : a.x - b.x)
                     : (vector.y > 0 ? b.y - a.y : a.y - b.y)
        );

        order.forEach(tile => {
            let nx = tile.x, ny = tile.y;
            while (true) {
                const x = nx + vector.x;
                const y = ny + vector.y;
                if (x < 0 || x > 3 || y < 0 || y > 3) break;

                const other = this.tileAt(x, y);
                if (!other) {
                    nx = x; ny = y;
                } else if (other.value === tile.value && !other.mergedToRemove) {
                    other.mergedToRemove = true;
                    tile.value *= 2;
                    this.updateScore(this.score + tile.value);
                    nx = x; ny = y;
                    break;
                } else break;
            }

            if (nx !== tile.x || ny !== tile.y) {
                tile.x = nx; tile.y = ny;
                tile.updateValue(tile.value);
                tile.updatePosition();
                moved = true;
            }
        });

        this.tiles = this.tiles.filter(t => !t.mergedToRemove);

        if (moved) {
            setTimeout(() => {
                this.addRandomTile();
                this.saveState();
                if (!this.movesAvailable()) this.showGameOver();
            }, 120);
        }
    }

    movesAvailable() {
        if (this.tiles.length < 16) return true;
        return this.tiles.some(t =>
            ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
                .some(d => {
                    const v = this.getVector(d);
                    const o = this.tileAt(t.x + v.x, t.y + v.y);
                    return o && o.value === t.value;
                })
        );
    }

    getVector(d) {
        return {
            ArrowUp:{x:0,y:-1},
            ArrowDown:{x:0,y:1},
            ArrowLeft:{x:-1,y:0},
            ArrowRight:{x:1,y:0}
        }[d];
    }

    setupInput() {
        document.addEventListener('keydown', e => {
            if (this.gameOverScreen.classList.contains('active')) return;
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.move(e.key);
            }
        });
    }
}

new Game2048();
