const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Уникальные ключи для localStorage, чтобы не пересекались с другими играми
const KEYS = {
    BEST_SCORE: '2048_v2_best_score',
    GAME_STATE: '2048_v2_game_state'
};

const Storage = {
    // Получение рекорда (Сначала Local, потом Cloud)
    getBestScore(callback) {
        // 1. Сразу возвращаем локальное значение, чтобы интерфейс не был пустым
        const localScore = parseInt(localStorage.getItem(KEYS.BEST_SCORE)) || 0;
        callback(localScore);

        // 2. В фоне стучимся в Телеграм
        if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
            tg.CloudStorage.getItem(KEYS.BEST_SCORE, (err, value) => {
                if (!err && value) {
                    const cloudScore = parseInt(value);
                    // Если в облаке больше, обновляем локально и в UI
                    if (cloudScore > localScore) {
                        localStorage.setItem(KEYS.BEST_SCORE, cloudScore);
                        callback(cloudScore); // Вызываем колбэк еще раз с новым значением
                    }
                    // Если локально наиграли больше (оффлайн), пушим в облако
                    else if (localScore > cloudScore) {
                        this.setBestScore(localScore);
                    }
                }
            });
        }
    },

    setBestScore(score) {
        // Сохраняем локально (синхронно, надежно)
        localStorage.setItem(KEYS.BEST_SCORE, score);

        // Пытаемся сохранить в облако (асинхронно)
        if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
            tg.CloudStorage.setItem(KEYS.BEST_SCORE, score.toString(), (err) => {
                if (err) console.log('Cloud save error:', err);
            });
        }
    },

    saveGameState(state) {
        // Сохраняем состояние поля только локально (быстро)
        try {
            localStorage.setItem(KEYS.GAME_STATE, JSON.stringify(state));
        } catch (e) {
            console.error("Save failed", e);
        }
    },

    getGameState() {
        try {
            const state = localStorage.getItem(KEYS.GAME_STATE);
            return state ? JSON.parse(state) : null;
        } catch (e) {
            return null;
        }
    },

    clearGameState() {
        localStorage.removeItem(KEYS.GAME_STATE);
    }
};

class Tile {
    constructor(container, value, x, y, cellSize, gap, isRestored = false) {
        this.container = container;
        this.value = value;
        this.x = x;
        this.y = y;
        this.cellSize = cellSize;
        this.gap = gap;
        this.mergedToRemove = false;

        this.element = document.createElement('div');
        this.element.className = `tile tile-${value <= 2048 ? value : 'super'}`;

        if (!isRestored) this.element.classList.add('tile-new');

        this.inner = document.createElement('div');
        this.inner.className = 'tile-inner';
        this.inner.textContent = value;
        this.element.appendChild(this.inner);

        this.updatePosition();
        this.container.appendChild(this.element);
    }

    updatePosition() {
        const xPx = this.x * (this.cellSize + this.gap);
        const yPx = this.y * (this.cellSize + this.gap);
        this.element.style.width = `${this.cellSize}px`;
        this.element.style.height = `${this.cellSize}px`;
        this.element.style.transform = `translate(${xPx}px, ${yPx}px)`;
    }

    serialize() {
        return { x: this.x, y: this.y, value: this.value };
    }

    remove() {
        if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
    }
}

class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.tiles = [];
        this.score = 0;
        this.bestScore = 0;
        this.gap = 10;

        this.container = document.getElementById('game-container');
        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');
        this.msgEl = document.getElementById('game-message');

        // Кнопки
        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
        document.getElementById('retry-btn').addEventListener('click', () => this.restart());

        this.resize();
        window.addEventListener('resize', () => {
            this.resize();
            this.tiles.forEach(t => {
                t.cellSize = this.cellSize;
                t.updatePosition();
            });
        });

        this.setupInput();
        this.init();
    }

    resize() {
        // Подгоняем размер под ширину контейнера (для iframe)
        const width = this.container.clientWidth;
        this.cellSize = (width - (this.gap * 2) - (this.gap * (this.gridSize - 1))) / this.gridSize;
    }

    init() {
        // 1. Загружаем рекорд (сработает дважды: сразу локально, потом обновится из облака)
        Storage.getBestScore((score) => {
            this.bestScore = score;
            this.bestScoreEl.innerText = this.bestScore;
        });

        // 2. Проверяем, была ли игра прервана
        const savedState = Storage.getGameState();
        if (savedState && savedState.tiles && !savedState.gameOver) {
            this.restoreGame(savedState);
        } else {
            this.startNewGame();
        }
    }

    startNewGame() {
        this.tileContainer.innerHTML = '';
        this.tiles = [];
        this.score = 0;
        this.scoreEl.innerText = '0';
        this.gameOverScreen.classList.remove('active');

        this.addRandomTile();
        this.addRandomTile();
        this.saveData();
    }

    restoreGame(state) {
        this.score = state.score;
        this.scoreEl.innerText = this.score;
        this.tileContainer.innerHTML = '';
        this.tiles = [];

        state.tiles.forEach(t => {
            const tile = new Tile(this.tileContainer, t.value, t.x, t.y, this.cellSize, this.gap, true);
            this.tiles.push(tile);
        });
    }

    saveData() {
        const isGameOver = this.gameOverScreen.classList.contains('active');

        // Рекорд сохраняем, если побили
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.bestScoreEl.innerText = this.bestScore;
            Storage.setBestScore(this.bestScore);
        }

        // Если игра окончена, стираем стейт поля
        if (isGameOver) {
            Storage.clearGameState();
            return;
        }

        // Сохраняем расстановку (Local Storage)
        Storage.saveGameState({
            score: this.score,
            gameOver: false,
            tiles: this.tiles.map(t => t.serialize())
        });
    }

    addRandomTile() {
        if (this.tiles.length >= 16) return;
        const available = [];
        for(let x=0; x<4; x++) {
            for(let y=0; y<4; y++) {
                if(!this.tiles.find(t => t.x===x && t.y===y && !t.mergedToRemove)) available.push({x,y});
            }
        }
        if (available.length) {
            const pos = available[Math.floor(Math.random()*available.length)];
            this.tiles.push(new Tile(this.tileContainer, Math.random()<0.9?2:4, pos.x, pos.y, this.cellSize, this.gap));
        }
    }

    move(direction) {
        if (this.gameOverScreen.classList.contains('active')) return;

        const vectors = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} };
        const vector = vectors[direction];
        if(!vector) return;

        let moved = false;
        // Очистка слияний
        this.tiles.forEach(t => t.mergedFrom = null);

        // Порядок обхода
        const xs = vector.x===1 ? [3,2,1,0] : [0,1,2,3];
        const ys = vector.y===1 ? [3,2,1,0] : [0,1,2,3];

        xs.forEach(x => {
            ys.forEach(y => {
                const tile = this.tiles.find(t => t.x===x && t.y===y && !t.mergedToRemove);
                if (tile) {
                    let cell = {x: tile.x, y: tile.y};
                    let next;
                    // Ищем самую дальнюю позицию
                    while(true) {
                        next = {x: cell.x + vector.x, y: cell.y + vector.y};
                        if (next.x<0 || next.x>3 || next.y<0 || next.y>3) break;
                        const other = this.tiles.find(t => t.x===next.x && t.y===next.y && !t.mergedToRemove);
                        if (other) {
                            // Слияние
                            if (other.value === tile.value && !other.mergedFrom) {
                                const merged = new Tile(this.tileContainer, tile.value*2, next.x, next.y, this.cellSize, this.gap);
                                merged.element.classList.add('tile-merged');
                                merged.mergedFrom = true;

                                tile.mergedToRemove = true;
                                other.mergedToRemove = true;

                                // Анимация движения старой плитки в новую точку перед удалением
                                tile.element.style.zIndex = 100; // Поверх всего
                                tile.x = next.x; tile.y = next.y; tile.updatePosition();

                                this.tiles.push(merged);
                                this.score += merged.value;
                                this.scoreEl.innerText = this.score;
                                moved = true;
                            }
                            break; // Уперлись в плитку
                        }
                        cell = next;
                    }

                    if ((cell.x !== tile.x || cell.y !== tile.y) && !tile.mergedToRemove) {
                        tile.x = cell.x;
                        tile.y = cell.y;
                        tile.updatePosition();
                        moved = true;
                    }
                }
            });
        });

        if (moved) {
            setTimeout(() => {
                this.tiles.forEach(t => { if(t.mergedToRemove) t.remove(); });
                this.tiles = this.tiles.filter(t => !t.mergedToRemove);
                this.addRandomTile();
                this.saveData(); // <--- ВАЖНО: СОХРАНЯЕМ СРАЗУ

                if (!this.movesAvailable()) {
                    this.msgEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
                    this.gameOverScreen.classList.add('active');
                    Storage.clearGameState();
                }
            }, 100);
        }
    }

    movesAvailable() {
        if (this.tiles.length < 16) return true;
        for(let t of this.tiles) {
            for(let dir of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) {
                const v = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} }[dir];
                const other = this.tiles.find(o => o.x === t.x + v.x && o.y === t.y + v.y && !o.mergedToRemove);
                if (other && other.value === t.value) return true;
            }
        }
        return false;
    }

    setupInput() {
        document.addEventListener('keydown', e => {
            if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.move(e.key);
            }
        });

        let startX, startY;
        const c = this.container;
        c.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        }, {passive:false});
        c.addEventListener('touchmove', e => e.preventDefault(), {passive:false});
        c.addEventListener('touchend', e => {
            if(!startX || !startY) return;
            const dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
            if(Math.abs(dx) > Math.abs(dy) && Math.abs(dx)>30) this.move(dx>0?'ArrowRight':'ArrowLeft');
            else if(Math.abs(dy)>30) this.move(dy>0?'ArrowDown':'ArrowUp');
            startX=null; startY=null;
        });
    }
}

new Game2048();