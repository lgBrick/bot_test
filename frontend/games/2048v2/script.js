const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// === Хранилище ===
// === Хранилище (Исправленное) ===
const Storage = {
    // Используем уникальный ключ. Если хочешь сбросить всем прогресс - поменяй v3 на v4
    KEY: '2048_best_score_v3',

    async getBestScore() {
        // 1. Сначала читаем локальное значение (это мгновенно)
        const localScore = parseInt(localStorage.getItem(this.KEY)) || 0;

        // 2. Проверяем, есть ли доступ к Telegram CloudStorage
        // Он доступен только в версии API 6.9+
        if (!tg.CloudStorage || !tg.isVersionAtLeast('6.9')) {
            console.log('CloudStorage недоступен, используем localStorage');
            return localScore;
        }

        // 3. Запрашиваем данные из облака
        return new Promise((resolve) => {
            tg.CloudStorage.getItem(this.KEY, (err, value) => {
                if (err) {
                    console.error('Ошибка чтения CloudStorage:', err);
                    resolve(localScore); // При ошибке отдаем локальное
                } else {
                    const cloudScore = value ? parseInt(value) : 0;

                    // ВАЖНО: Берем MAX, чтобы не потерять прогресс при плохом интернете
                    const finalScore = Math.max(localScore, cloudScore);

                    // Если локально мы наиграли больше, чем было в облаке — обновим облако прямо сейчас
                    if (localScore > cloudScore) {
                        this.setBestScore(localScore);
                    }
                    // Если в облаке больше (с другого устройства), обновим локальное хранилище
                    else if (cloudScore > localScore) {
                        localStorage.setItem(this.KEY, cloudScore);
                    }

                    resolve(finalScore);
                }
            });
        });
    },

    setBestScore(score) {
        // 1. Всегда сохраняем в localStorage (резервная копия)
        localStorage.setItem(this.KEY, score);

        // 2. Пытаемся сохранить в Telegram Cloud
        if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
            // Ключ и Значение ОБЯЗАНЫ быть строками
            tg.CloudStorage.setItem(this.KEY, score.toString(), (err, stored) => {
                if (err) {
                    console.error('Ошибка сохранения в CloudStorage:', err);
                }
            });
        }
    }
};

// === Класс Плитки (Матрешка) ===
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

        // 1. Внешний элемент (позиция)
        this.element = document.createElement('div');
        this.element.classList.add('tile', `tile-${value}`);

        // 2. Внутренний элемент (визуал и анимация scale)
        this.inner = document.createElement('div');
        this.inner.classList.add('tile-inner');
        this.inner.textContent = value;

        this.element.appendChild(this.inner);

        // Установка начальной позиции СРАЗУ (без анимации движения)
        this.updatePosition();

        // Добавляем класс 'tile-new' для анимации scale только на inner
        this.element.classList.add('tile-new');

        this.container.appendChild(this.element);
    }

    updatePosition() {
        const xPx = this.x * (this.cellSize + this.gap);
        const yPx = this.y * (this.cellSize + this.gap);
        this.element.style.width = `${this.cellSize}px`;
        this.element.style.height = `${this.cellSize}px`;
        // Изменяем координаты внешнего контейнера
        this.element.style.transform = `translate(${xPx}px, ${yPx}px)`;
    }

    updateValue(newValue) {
        this.value = newValue;
        this.inner.textContent = newValue;
        // Обновляем классы для цвета
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
}

// === ИГРОВОЙ ДВИЖОК ===
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
        this.gameMessageEl = document.getElementById('game-message'); // Получаем элемент текста

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
        this.bestScore = await Storage.getBestScore();
        this.bestScoreEl.innerText = this.bestScore;
        this.restart();
    }

    restart() {
        this.tileContainer.innerHTML = '';
        this.tiles = [];
        this.score = 0;
        this.updateScore(0);

        // Убираем класс active для плавного скрытия
        this.gameOverScreen.classList.remove('active');

        this.addRandomTile();
        this.addRandomTile();
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

                // === ПРОВЕРКА ПРОИГРЫША ===
                // Если ходов больше нет (доска полная и слияния невозможны)
                if (!this.movesAvailable()) {
                    this.showGameOver();
                }
            }, 100);
        }
    }

    // === НОВЫЙ МЕТОД: Показ экрана проигрыша ===
    showGameOver() {
        // Показываем текст с результатом
        this.gameMessageEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
        // Добавляем класс для плавного появления
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
        // Исправлена проверка: если длина массива < 16, значит место есть
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
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
            Storage.setBestScore(this.bestScore);
        }
    }

    setupInput() {
        document.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                // Если игра окончена, блокируем управление
                if (this.gameOverScreen.classList.contains('active')) return;
                this.move(e.key);
            }
        });

        const c = this.gameContainer;
        let startX, startY;

        c.addEventListener('touchstart', (e) => {
            // Если игра окончена, блокируем свайпы
            if (this.gameOverScreen.classList.contains('active')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: false});

        c.addEventListener('touchmove', (e) => e.preventDefault(), {passive: false});

        c.addEventListener('touchend', (e) => {
            // Если игра окончена, блокируем свайпы
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