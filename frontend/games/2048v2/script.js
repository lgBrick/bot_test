const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// === ХРАНЕНИЕ (CloudStorage) ===
const Storage = {
    KEY: '2048_best_score_v2',
    async getBestScore() {
        return new Promise((resolve) => {
            try {
                tg.CloudStorage.getItem(this.KEY, (err, value) => {
                    if (!err && value) resolve(parseInt(value) || 0);
                    else resolve(parseInt(localStorage.getItem(this.KEY)) || 0);
                });
            } catch (e) { resolve(parseInt(localStorage.getItem(this.KEY)) || 0); }
        });
    },
    setBestScore(score) {
        localStorage.setItem(this.KEY, score);
        try { tg.CloudStorage.setItem(this.KEY, score.toString()); } catch (e) {}
    }
};

// === ИГРА ===
class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.score = 0;
        this.bestScore = 0;

        // Сетка 4x4, хранит объекты { value, id, merged } или null
        this.grid = [];
        this.tileIdCounter = 0;

        // DOM
        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');

        // Размеры
        const containerWidth = document.getElementById('game-container').clientWidth;
        this.gap = 10;
        this.cellSize = (containerWidth - 5 * this.gap) / 4;

        this.touchStartX = 0;
        this.touchStartY = 0;

        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
        document.getElementById('retry-btn').addEventListener('click', () => this.restart());

        this.init();
    }

    async init() {
        this.bestScore = await Storage.getBestScore();
        this.bestScoreEl.innerText = this.bestScore;
        this.setupInput();
        this.restart();
    }

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
    }

    // --- ЛОГИКА ---
    addRandomTile() {
        const empty = [];
        for(let r=0; r<4; r++)
            for(let c=0; c<4; c++)
                if(!this.grid[r][c]) empty.push({r,c});

        if (empty.length > 0) {
            const {r, c} = empty[Math.floor(Math.random() * empty.length)];
            this.grid[r][c] = {
                value: Math.random() < 0.9 ? 2 : 4,
                id: this.tileIdCounter++,
                isNew: true, // Флаг для анимации появления
                merged: false
            };
        }
    }

    // --- ОТРИСОВКА ---
    draw() {
        window.requestAnimationFrame(() => {
            const tilesInGrid = new Set();

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    const tile = this.grid[r][c];
                    if (tile) {
                        tilesInGrid.add(tile.id);
                        this.drawTile(tile, r, c);
                        tile.isNew = false; // Сбрасываем флаг новизны
                        tile.merged = false;
                    }
                }
            }

            // Удаляем "мертвые" плитки из DOM
            const domTiles = document.querySelectorAll('.tile');
            domTiles.forEach(el => {
                if (!tilesInGrid.has(parseInt(el.dataset.id))) {
                    el.remove();
                }
            });
        });
    }

    drawTile(tile, r, c) {
        let el = document.querySelector(`.tile[data-id="${tile.id}"]`);
        const x = this.gap + c * (this.cellSize + this.gap);
        const y = this.gap + r * (this.cellSize + this.gap);
        const transform = `translate(${x}px, ${y}px)`;

        // Если элемента нет - создаем
        if (!el) {
            el = document.createElement('div');
            el.dataset.id = tile.id;
            el.className = `tile tile-${tile.value}`;
            el.innerText = tile.value;
            // СРАЗУ ставим позицию, чтобы не летел из 0,0
            el.style.transform = transform;

            if (tile.isNew) el.classList.add('tile-new');

            this.tileContainer.appendChild(el);
        } else {
            // Обновляем существующий
            el.style.transform = transform;
            el.className = `tile tile-${tile.value}`;
            el.innerText = tile.value;

            if (tile.merged) {
                el.classList.add('tile-merged');
            }
        }
    }

    // --- ДВИЖЕНИЕ (ЯДРО) ---
    move(dir) {
        // 0:Up, 1:Right, 2:Down, 3:Left
        const vectors = {
            'ArrowUp': {x: 0, y: -1},
            'ArrowDown': {x: 0, y: 1},
            'ArrowLeft': {x: -1, y: 0},
            'ArrowRight': {x: 1, y: 0}
        };
        const vector = vectors[dir];
        if(!vector) return;

        let moved = false;

        // Порядок обхода ячеек
        const rows = [0,1,2,3];
        const cols = [0,1,2,3];
        if (vector.x === 1) cols.reverse(); // Вправо: начинаем справа
        if (vector.y === 1) rows.reverse(); // Вниз: начинаем снизу

        // Сброс флагов слияния перед ходом
        this.grid.forEach(row => row.forEach(t => { if(t) t.merged = false; }));

        rows.forEach(r => {
            cols.forEach(c => {
                const tile = this.grid[r][c];
                if (tile) {
                    let nextR = r;
                    let nextC = c;

                    // Ищем самую дальнюю свободную позицию
                    while (true) {
                        const checkR = nextR + vector.y;
                        const checkC = nextC + vector.x;

                        if (checkR < 0 || checkR > 3 || checkC < 0 || checkC > 3) break;

                        const nextTile = this.grid[checkR][checkC];

                        if (!nextTile) {
                            // Пусто - двигаем дальше
                            nextR = checkR;
                            nextC = checkC;
                        } else if (nextTile.value === tile.value && !nextTile.merged) {
                            // Слияние!
                            const newValue = tile.value * 2;
                            this.score += newValue;

                            // Удаляем старую плитку (визуально она "вкатится" в новую)
                            this.grid[r][c] = null;

                            // Обновляем плитку, в которую вкатились
                            nextTile.value = newValue;
                            nextTile.merged = true; // Блокируем повторное слияние за ход

                            // Хак для красивой анимации:
                            // На самом деле tile (текущий) должен исчезнуть, а nextTile обновиться.
                            // Но мы просто удалим текущий и обновим целевой.
                            // В профессиональной версии делают сложнее, но для Mini App этого достаточно.

                            moved = true;
                            break; // Дальше не идем
                        } else {
                            // Уперлись в другую плитку
                            break;
                        }
                    }

                    // Если просто сдвиг (без слияния)
                    if ((nextR !== r || nextC !== c) && !this.grid[r][c] === null) {
                         // тут логика если слияния не было выше
                    }

                    // Упрощенная логика сдвига (чтобы избежать дублей)
                    // Если позиция изменилась и мы еще не обработали слияние (tile еще в сетке)
                    if ((nextR !== r || nextC !== c) && this.grid[r][c]) {
                        const target = this.grid[nextR][nextC];
                        if (!target) {
                            // Перенос в пустую
                            this.grid[nextR][nextC] = tile;
                            this.grid[r][c] = null;
                            moved = true;
                        } else if (target.value === tile.value && !target.merged) {
                            // Слияние (повтор логики выше для надежности)
                            target.value *= 2;
                            target.merged = true;
                            this.score += target.value;
                            this.grid[r][c] = null;
                            moved = true;
                        }
                    }
                }
            });
        });

        if (moved) {
            this.updateScore(this.score);
            this.addRandomTile();
            this.draw();
            if (this.isGameOver()) {
                setTimeout(() => this.gameOverScreen.style.display = 'flex', 500);
            }
        }
    }

    updateScore(s) {
        this.score = s;
        this.scoreEl.innerText = this.score;
        if(this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
            Storage.setBestScore(this.bestScore);
        }
    }

    isGameOver() {
        for(let r=0; r<4; r++)
            for(let c=0; c<4; c++)
                if(!this.grid[r][c]) return false;

        for(let r=0; r<4; r++)
            for(let c=0; c<4; c++) {
                const val = this.grid[r][c].value;
                if (c<3 && this.grid[r][c+1].value === val) return false;
                if (r<3 && this.grid[r+1][c].value === val) return false;
            }
        return true;
    }

    // --- УПРАВЛЕНИЕ ---
    setupInput() {
        window.addEventListener('keydown', (e) => {
            if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
                e.preventDefault();
                this.move(e.key);
            }
        });

        const c = document.getElementById('game-container');
        c.addEventListener('touchstart', e => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, {passive: false});

        c.addEventListener('touchmove', e => e.preventDefault(), {passive: false});

        c.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - this.touchStartX;
            const dy = e.changedTouches[0].clientY - this.touchStartY;
            if(Math.abs(dx) > 30 || Math.abs(dy) > 30) {
                if(Math.abs(dx) > Math.abs(dy)) this.move(dx>0 ? 'ArrowRight' : 'ArrowLeft');
                else this.move(dy>0 ? 'ArrowDown' : 'ArrowUp');
            }
        }, {passive: false});
    }
}

new Game2048();