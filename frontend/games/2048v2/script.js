const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// === Хранилище ===
// --- script.js (Внутри игры 2048) ---

const Storage = {
    // Уникальный ключ для этой игры. Если сделаешь другую игру, поменяй этот ключ!
    BEST_SCORE_KEY: 'game_2048_best_score',
    GAME_STATE_KEY: 'game_2048_state',

    // --- Получение рекорда ---
    async getBestScore() {
        const localScore = parseInt(localStorage.getItem(this.BEST_SCORE_KEY)) || 0;

        // Если старая версия Telegram или нет CloudStorage, возвращаем локальное
        if (!tg.CloudStorage || !tg.isVersionAtLeast('6.9')) {
            return localScore;
        }

        return new Promise((resolve) => {
            tg.CloudStorage.getItem(this.BEST_SCORE_KEY, (err, value) => {
                if (err) {
                    console.error('[Cloud] Read Error:', err);
                    resolve(localScore); // При ошибке верим локальному
                } else {
                    const cloudScore = value ? parseInt(value) : 0;

                    // Синхронизация: выбираем большее значение
                    if (cloudScore > localScore) {
                        // В облаке больше -> обновляем локальное
                        localStorage.setItem(this.BEST_SCORE_KEY, cloudScore);
                        resolve(cloudScore);
                    } else if (localScore > cloudScore) {
                        // Локально больше -> пушим в облако
                        this.setBestScore(localScore);
                        resolve(localScore);
                    } else {
                        resolve(localScore);
                    }
                }
            });
        });
    },

    // --- Сохранение рекорда ---
    setBestScore(score) {
        // 1. Сохраняем локально мгновенно
        localStorage.setItem(this.BEST_SCORE_KEY, score);

        // 2. Сохраняем в облако (асинхронно)
        if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
            tg.CloudStorage.setItem(this.BEST_SCORE_KEY, score.toString(), (err, isStored) => {
                if (err) {
                    console.error('[Cloud] Save Error:', err);
                } else if (isStored) {
                    console.log('[Cloud] Score saved:', score);
                }
            });
        }
    },

    // ... методы gameState остаются такими же (они нужны только локально для продолжения сессии)
    saveGameState(gridState) {
        localStorage.setItem(this.GAME_STATE_KEY, JSON.stringify(gridState));
    },

    getGameState() {
        const state = localStorage.getItem(this.GAME_STATE_KEY);
        return state ? JSON.parse(state) : null;
    },

    clearGameState() {
        localStorage.removeItem(this.GAME_STATE_KEY);
    }
};
// === Класс Плитки ===
class Tile {
    constructor(container, value, x, y, cellSize, gap) {
        this.container = container;
        this.value = value;
        this.x = x;
        this.y = y;
        this.cellSize = cellSize;
        this.gap = gap;
        this.mergedFrom = null;
        this.mergedToRemove = false;

        this.element = document.createElement('div');
        this.element.classList.add('tile', `tile-${value}`);

        this.inner = document.createElement('div');
        this.inner.classList.add('tile-inner');
        this.inner.textContent = value;

        this.element.appendChild(this.inner);
        this.updatePosition();

        // Анимацию 'tile-new' добавляем только если это новая плитка, а не восстановленная
        // Но для простоты оставим, визуально это не сильно мешает при загрузке
        this.element.classList.add('tile-new');

        this.container.appendChild(this.element);
    }

    updatePosition() {
        const xPx = this.x * (this.cellSize + this.gap);
        const yPx = this.y * (this.cellSize + this.gap);
        this.element.style.width = `${this.cellSize}px`;
        this.element.style.height = `${this.cellSize}px`;
        this.element.style.transform = `translate(${xPx}px, ${yPx}px)`;
    }

    updateValue(newValue) {
        this.value = newValue;
        this.inner.textContent = newValue;
        this.element.className = `tile tile-${newValue <= 2048 ? newValue : 'super'}`;
    }

    remove() {
        if (this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    savePosition() {
        this.previousPosition = { x: this.x, y: this.y };
    }

    // Метод для сохранения данных плитки в JSON
    serialize() {
        return {
            position: { x: this.x, y: this.y },
            value: this.value
        };
    }
}

// === ИГРОВОЙ ДВИЖОК ===
class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.tiles = [];
        this.score = 0;
        this.bestScore = 0;

        this.gameContainer = document.getElementById('game-container');
        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');
        this.gameMessageEl = document.getElementById('game-message');

        this.gap = 10;
        this.calculateDimensions();
        this.setupInput();

        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
        document.getElementById('retry-btn').addEventListener('click', () => this.restart());

        this.init();
    }

    calculateDimensions() {
        const width = this.gameContainer.clientWidth;
        this.cellSize = (width - (this.gap * 2) - (this.gap * (this.gridSize - 1))) / this.gridSize;
    }

    async init() {
        // 1. Загружаем лучший рекорд (ждем ответа от телеграма)
        this.bestScore = await Storage.getBestScore();
        this.bestScoreEl.innerText = this.bestScore;

        // 2. Проверяем, была ли незавершенная игра
        const savedState = Storage.getGameState();

        if (savedState) {
            this.restoreGame(savedState);
        } else {
            this.restart();
        }
    }

    // Восстановление игры из памяти
    restoreGame(savedState) {
        this.score = savedState.score;
        this.scoreEl.innerText = this.score;
        this.gameOverScreen.classList.remove('active');
        this.tileContainer.innerHTML = '';
        this.tiles = [];

        // Воссоздаем плитки из JSON
        if (savedState.tiles) {
            savedState.tiles.forEach(tileData => {
                const tile = new Tile(
                    this.tileContainer,
                    tileData.value,
                    tileData.position.x,
                    tileData.position.y,
                    this.cellSize,
                    this.gap
                );
                // Убираем анимацию появления при загрузке, чтобы не мелькало
                tile.element.classList.remove('tile-new');
                this.tiles.push(tile);
            });
        }
    }

    restart() {
        // При рестарте очищаем сохранение
        Storage.clearGameState();

        this.tileContainer.innerHTML = '';
        this.tiles = [];
        this.score = 0;
        this.updateScore(0);
        this.gameOverScreen.classList.remove('active');
        this.addRandomTile();
        this.addRandomTile();

        // Сразу сохраняем новое начало игры
        this.saveData();
    }

    // Метод сохранения текущего состояния
    saveData() {
        // Сохраняем рекорд
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
            Storage.setBestScore(this.bestScore);
        }

        // Если игра проиграна - не сохраняем расстановку (чтобы при входе не видеть Game Over снова и снова)
        if (this.gameOverScreen.classList.contains('active')) {
            Storage.clearGameState();
            return;
        }

        // Сохраняем расстановку плиток
        const gridState = {
            score: this.score,
            tiles: this.tiles.map(tile => tile.serialize())
        };
        Storage.saveGameState(gridState);
    }

    addRandomTile() {
        if (this.tiles.length >= 16) return;
        let available = [];
        for (let x = 0; x < 4; x++) {
            for (let y = 0; y < 4; y++) {
                if (!this.getCellContent(x, y)) available.push({x, y});
            }
        }
        if (available.length > 0) {
            const pos = available[Math.floor(Math.random() * available.length)];
            const value = Math.random() < 0.9 ? 2 : 4;
            const tile = new Tile(this.tileContainer, value, pos.x, pos.y, this.cellSize, this.gap);
            this.tiles.push(tile);
        }
    }

    getCellContent(x, y) {
        return this.tiles.find(t => t.x === x && t.y === y && !t.mergedToRemove);
    }

    move(direction) {
        // Если игра окончена, не двигаем
        if (this.gameOverScreen.classList.contains('active')) return;

        const vector = this.getVector(direction);
        const traversals = this.buildTraversals(vector);
        let moved = false;

        this.tiles.forEach(t => {
            t.mergedFrom = null;
            t.savePosition();
            t.element.classList.remove('tile-new', 'tile-merged');
        });

        traversals.x.forEach(x => {
            traversals.y.forEach(y => {
                const tile = this.getCellContent(x, y);

                if (tile) {
                    const positions = this.findFarthestPosition({x, y}, vector);
                    const next = this.getCellContent(positions.next.x, positions.next.y);

                    if (next && next.value === tile.value && !next.mergedFrom) {
                        const merged = new Tile(this.tileContainer, tile.value * 2, next.x, next.y, this.cellSize, this.gap);
                        merged.element.classList.add('tile-merged');

                        tile.x = next.x;
                        tile.y = next.y;
                        tile.updatePosition();

                        tile.mergedToRemove = true;
                        next.mergedToRemove = true;

                        merged.mergedFrom = [tile, next];
                        this.tiles.push(merged);

                        this.updateScore(this.score + merged.value);
                        moved = true;
                    } else {
                        if (positions.farthest.x !== x || positions.farthest.y !== y) {
                            tile.x = positions.farthest.x;
                            tile.y = positions.farthest.y;
                            tile.updatePosition();
                            moved = true;
                        }
                    }
                }
            });
        });

        if (moved) {
            setTimeout(() => {
                this.tiles.forEach(t => {
                    if(t.mergedToRemove) t.remove();
                });
                this.tiles = this.tiles.filter(t => !t.mergedToRemove);

                this.addRandomTile();

                // === СОХРАНЯЕМ ИГРУ ПОСЛЕ КАЖДОГО УСПЕШНОГО ХОДА ===
                this.saveData();

                if (!this.movesAvailable()) {
                    this.showGameOver();
                    // При проигрыше удаляем сохранение, чтобы следующая игра началась с нуля
                    Storage.clearGameState();
                }
            }, 100);
        }
    }

    showGameOver() {
        this.gameMessageEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
        this.gameOverScreen.classList.add('active');
    }

    getVector(direction) {
        const map = { 'ArrowUp': {x:0, y:-1}, 'ArrowRight': {x:1, y:0}, 'ArrowDown': {x:0, y:1}, 'ArrowLeft': {x:-1, y:0} };
        return map[direction];
    }

    buildTraversals(vector) {
        const traversals = { x: [0, 1, 2, 3], y: [0, 1, 2, 3] };
        if (vector.x === 1) traversals.x.reverse();
        if (vector.y === 1) traversals.y.reverse();
        return traversals;
    }

    findFarthestPosition(cell, vector) {
        let previous;
        do {
            previous = cell;
            cell = { x: previous.x + vector.x, y: previous.y + vector.y };
        } while (
            cell.x >= 0 && cell.x < 4 &&
            cell.y >= 0 && cell.y < 4 &&
            !this.getCellContent(cell.x, cell.y)
        );
        return { farthest: previous, next: cell };
    }

    movesAvailable() {
        return this.tiles.length < 16 || this.tileMatchesAvailable();
    }

    tileMatchesAvailable() {
        for (let t of this.tiles) {
            for (let dir of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
                const vector = this.getVector(dir);
                const target = { x: t.x + vector.x, y: t.y + vector.y };
                const other = this.getCellContent(target.x, target.y);
                if (other && other.value === t.value) return true;
            }
        }
        return false;
    }

    updateScore(newScore) {
        this.score = newScore;
        this.scoreEl.innerText = this.score;
        // Рекорд здесь не сохраняем в облако каждый раз (чтобы не спамить),
        // а только в переменной, сохранение будет в saveData()
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
        }
    }

    setupInput() {
        document.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                if (this.gameOverScreen.classList.contains('active')) return;
                this.move(e.key);
            }
        });

        const c = this.gameContainer;
        let startX, startY;

        c.addEventListener('touchstart', (e) => {
            if (this.gameOverScreen.classList.contains('active')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: false});

        c.addEventListener('touchmove', (e) => e.preventDefault(), {passive: false});

        c.addEventListener('touchend', (e) => {
            if (this.gameOverScreen.classList.contains('active')) return;
            if (!startX || !startY) return;

            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
                if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
                else this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
            }
        }, {passive: false});
    }
}

new Game2048();