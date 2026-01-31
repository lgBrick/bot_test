const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// === КЛАСС ХРАНЕНИЯ (без изменений) ===
const Storage = {
    KEY: '2048_best_score',
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

// === ВСПОМОГАТЕЛЬНЫЙ КЛАСС: ПЛИТКА ===
class Tile {
    constructor(r, c, value) {
        this.r = r;
        this.c = c;
        this.value = value;
        this.previousPosition = null;
        this.mergedFrom = null; // Какие плитки создали эту (для анимации)
        this.id = Tile.idCounter++; // Уникальный ID для DOM элемента
    }

    savePosition() {
        this.previousPosition = { r: this.r, c: this.c };
    }

    updatePosition(r, c) {
        this.r = r;
        this.c = c;
    }
}
Tile.idCounter = 0;

// === ГЛАВНЫЙ КЛАСС ИГРЫ ===
class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.score = 0;
        this.bestScore = 0;

        // Массив, в котором хранятся объекты Tile или null
        this.grid = [];

        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');

        // Размеры для расчета позиций (вычисляем один раз)
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

    // === ЛОГИКА ИГРЫ ===

    restart() {
        this.grid = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(null));
        this.score = 0;
        this.updateScore(0);
        this.gameOverScreen.style.display = 'none';
        this.tileContainer.innerHTML = ''; // Чистим DOM
        Tile.idCounter = 0;

        this.addRandomTile();
        this.addRandomTile();
        this.actuate(); // Отрисовка
    }

    addRandomTile() {
        const cells = [];
        for(let r=0; r<this.gridSize; r++)
            for(let c=0; c<this.gridSize; c++)
                if(!this.grid[r][c]) cells.push({r,c});

        if (cells.length > 0) {
            const {r, c} = cells[Math.floor(Math.random() * cells.length)];
            const tile = new Tile(r, c, Math.random() < 0.9 ? 2 : 4);
            this.grid[r][c] = tile;
        }
    }

    // --- ОТРИСОВКА (СИНХРОНИЗАЦИЯ DOM) ---
    actuate() {
        // Проходимся по всем плиткам и рисуем их
        window.requestAnimationFrame(() => {
            const existingIds = new Set();

            for (let r = 0; r < this.gridSize; r++) {
                for (let c = 0; c < this.gridSize; c++) {
                    const tile = this.grid[r][c];
                    if (tile) {
                        this.addOrUpdateTile(tile);
                        existingIds.add(tile.id);

                        // Если плитка возникла из слияния, нужно отрисовать "родителей", чтобы они доехали и исчезли
                        if (tile.mergedFrom) {
                            tile.mergedFrom.forEach(merged => {
                                this.addOrUpdateTile(merged);
                                existingIds.add(merged.id);
                            });
                        }
                    }
                }
            }

            // Удаляем из DOM плитки, которых больше нет в сетке
            const domTiles = this.tileContainer.querySelectorAll('.tile');
            domTiles.forEach(dom => {
                const id = parseInt(dom.dataset.id);
                if (!existingIds.has(id)) {
                    dom.remove();
                }
            });
        });
    }

    addOrUpdateTile(tile) {
        let el = document.querySelector(`.tile[data-id="${tile.id}"]`);

        // Позиция в пикселях
        const pxX = this.gap + tile.c * (this.cellSize + this.gap);
        const pxY = this.gap + tile.r * (this.cellSize + this.gap);

        // Если элемента нет - создаем
        if (!el) {
            el = document.createElement('div');
            el.classList.add('tile', `tile-${tile.value}`);
            el.dataset.id = tile.id;
            el.innerText = tile.value;
            // Начальная позиция
            el.style.transform = `translate(${pxX}px, ${pxY}px)`;

            // Если это новая плитка (не результат слияния и не старая), добавляем анимацию появления
            if (!tile.mergedFrom && !tile.previousPosition) {
                el.classList.add('tile-new');
            }

            this.tileContainer.appendChild(el);
        } else {
            // Если есть - обновляем позицию и класс
            // Мы используем requestAnimationFrame для плавности, но CSS transition сделает всю работу
            el.style.transform = `translate(${pxX}px, ${pxY}px)`;

            // Обновляем число и цвет (если изменились)
            el.className = `tile tile-${tile.value}`;

            // Если это результат слияния
            if (tile.mergedFrom) {
                el.classList.add('tile-merged');
                // Удаляем родителей из DOM после завершения анимации
                setTimeout(() => {
                   tile.mergedFrom = null;
                   // При следующем actuate родители удалятся, так как ссылка на них пропадет
                   this.actuate();
                }, 200);
            }
        }
    }

    // --- ДВИЖЕНИЕ ---
    move(direction) {
        // Векторы направлений
        const vectors = {
            'ArrowUp': {x: 0, y: -1},
            'ArrowDown': {x: 0, y: 1},
            'ArrowLeft': {x: -1, y: 0},
            'ArrowRight': {x: 1, y: 0}
        };
        const vector = vectors[direction];
        if (!vector) return;

        // Подготовка к движению
        this.prepareTiles();

        let moved = false;

        // Порядок обхода ячеек важен!
        // Если двигаем вправо, начинаем справа. Если вниз - снизу.
        const rows = []; const cols = [];
        for(let i=0; i<this.gridSize; i++) { rows.push(i); cols.push(i); }

        if (vector.x === 1) cols.reverse();
        if (vector.y === 1) rows.reverse();

        // Логика сдвига
        rows.forEach(r => {
            cols.forEach(c => {
                const tile = this.grid[r][c];
                if (tile) {
                    const positions = this.findFarthestPosition(r, c, vector);
                    const next = this.grid[positions.next.r][positions.next.c];

                    if (next && next.value === tile.value && !next.mergedFrom) {
                        // СЛИЯНИЕ
                        const merged = new Tile(positions.next.r, positions.next.c, tile.value * 2);
                        merged.mergedFrom = [tile, next];

                        this.grid[r][c] = null;
                        this.grid[positions.next.r][positions.next.c] = merged;

                        // Обновляем координаты старых плиток, чтобы они "доехали" до точки слияния
                        tile.updatePosition(positions.next.r, positions.next.c);

                        this.score += merged.value;
                        moved = true;
                    } else {
                        // ПРОСТО СДВИГ
                        this.grid[r][c] = null;
                        this.grid[positions.farthest.r][positions.farthest.c] = tile;
                        tile.updatePosition(positions.farthest.r, positions.farthest.c);

                        if (r !== positions.farthest.r || c !== positions.farthest.c) moved = true;
                    }
                }
            });
        });

        if (moved) {
            this.updateScore(this.score);
            this.addRandomTile();
            this.actuate(); // Запускаем анимацию

            if (this.isGameOver()) {
                setTimeout(() => this.gameOverScreen.style.display = 'flex', 400);
            }
        }
    }

    prepareTiles() {
        for(let r=0; r<this.gridSize; r++) {
            for(let c=0; c<this.gridSize; c++) {
                if (this.grid[r][c]) {
                    this.grid[r][c].mergedFrom = null;
                    this.grid[r][c].savePosition();
                }
            }
        }
    }

    findFarthestPosition(r, c, vector) {
        let prev;
        // Двигаемся в направлении вектора, пока в пределах поля и ячейка пуста
        do {
            prev = {r, c};
            r += vector.y;
            c += vector.x;
        } while (
            r >= 0 && r < this.gridSize &&
            c >= 0 && c < this.gridSize &&
            this.grid[r][c] === null
        );

        return {
            farthest: prev,
            next: {r, c} // Это ячейка, в которую мы врезались (или вышли за край)
        };
    }

    updateScore(score) {
        this.score = score;
        this.scoreEl.innerText = this.score;
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
            Storage.setBestScore(this.bestScore);
        }
    }

    isGameOver() {
        for(let r=0; r<4; r++)
            for(let c=0; c<4; c++)
                if(!this.grid[r][c]) return false;

        for(let r=0; r<4; r++) {
            for(let c=0; c<4; c++) {
                const tile = this.grid[r][c];
                if (c<3 && tile.value === this.grid[r][c+1].value) return false;
                if (r<3 && tile.value === this.grid[r+1][c].value) return false;
            }
        }
        return true;
    }

    // --- УПРАВЛЕНИЕ ---
    setupInput() {
        document.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.move(e.key);
            }
        });

        const container = document.getElementById('game-container');
        container.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, {passive: false});

        container.addEventListener('touchmove', (e) => e.preventDefault(), {passive: false});

        container.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - this.touchStartX;
            const dy = e.changedTouches[0].clientY - this.touchStartY;
            if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
                if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
                else this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
            }
        }, {passive: false});
    }
}

new Game2048();