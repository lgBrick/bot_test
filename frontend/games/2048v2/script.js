document.addEventListener('DOMContentLoaded', () => {
    // === ЛОГИРОВАНИЕ (для отладки на телефоне) ===
    const debugEl = document.createElement('div');
    debugEl.style.cssText = "position:absolute; bottom:5px; left:0; width:100%; text-align:center; font-size:10px; color:#aaa; pointer-events:none; z-index:9999;";
    debugEl.id = 'debug-log';
    document.body.appendChild(debugEl);

    function log(msg) {
        console.log('[2048]', msg);
        // if(debugEl) debugEl.innerText = msg; // Раскомментируй, если нужно видеть ошибки на экране
    }

    // === ИНИЦИАЛИЗАЦИЯ TELEGRAM И ХРАНИЛИЩА ===
    let tg = window.Telegram.WebApp;
    let safeStorage = window.localStorage;

    try { tg.ready(); } catch (e) { log('TG Init Error: ' + e.message); }

    const KEYS = {
        BEST_SCORE: '2048_best_score',
        GAME_STATE: '2048_game_state'
    };

    const StorageManager = {
        setBestScore(score) {
            const scoreStr = score.toString();
            try { safeStorage.setItem(KEYS.BEST_SCORE, scoreStr); } catch (e) {}

            if (tg && tg.CloudStorage) {
                tg.CloudStorage.setItem(KEYS.BEST_SCORE, scoreStr, (err, saved) => {
                    if (err) log('Cloud Save ERR: ' + err);
                });
            }
        },

        getBestScore(callback) {
            let localScore = 0;
            try { localScore = parseInt(safeStorage.getItem(KEYS.BEST_SCORE)) || 0; } catch (e) {}
            callback(localScore);

            if (tg && tg.CloudStorage) {
                tg.CloudStorage.getItem(KEYS.BEST_SCORE, (err, value) => {
                    if (!err && value) {
                        const cloudScore = parseInt(value) || 0;
                        if (cloudScore > localScore) {
                            safeStorage.setItem(KEYS.BEST_SCORE, cloudScore);
                            callback(cloudScore);
                        } else if (localScore > cloudScore) {
                            this.setBestScore(localScore);
                        }
                    }
                });
            }
        },

        saveState(state) {
            try { safeStorage.setItem(KEYS.GAME_STATE, JSON.stringify(state)); } catch (e) {}
        },

        getState() {
            try {
                const s = safeStorage.getItem(KEYS.GAME_STATE);
                return s ? JSON.parse(s) : null;
            } catch (e) { return null; }
        },

        clearState() {
            try { safeStorage.removeItem(KEYS.GAME_STATE); } catch(e) {}
        }
    };

    // === КЛАСС ПЛИТКИ ===
    class Tile {
        constructor(container, value, x, y, cellSize, gap, type = 'new') {
            this.container = container;
            this.value = value;
            this.x = x;
            this.y = y;
            this.cellSize = cellSize;
            this.gap = gap;
            this.markedForDeletion = false;

            this.element = document.createElement('div');
            // type может быть: 'new' (анимация появления), 'merged' (анимация слияния), 'restored' (без анимации)
            this.element.className = `tile tile-${value <= 2048 ? value : 'super'}`;

            if (type === 'new') this.element.classList.add('tile-new');
            if (type === 'merged') this.element.classList.add('tile-merged');

            this.inner = document.createElement('div');
            this.inner.className = 'tile-inner';
            this.inner.textContent = value;
            this.element.appendChild(this.inner);

            this.updatePosition();
            this.container.appendChild(this.element);
        }

        updatePosition() {
            // Расчет позиции в пикселях
            const xPx = this.x * (this.cellSize + this.gap);
            const yPx = this.y * (this.cellSize + this.gap);

            this.element.style.width = `${this.cellSize}px`;
            this.element.style.height = `${this.cellSize}px`;
            // Используем transform для аппаратного ускорения (плавность)
            this.element.style.transform = `translate(${xPx}px, ${yPx}px)`;
        }

        updateValue(newValue) {
            this.value = newValue;
            this.element.className = `tile tile-${newValue <= 2048 ? newValue : 'super'} tile-merged`;
            this.inner.textContent = newValue;
        }

        serialize() { return { x: this.x, y: this.y, value: this.value }; }
        remove() { if(this.element.parentNode) this.element.parentNode.removeChild(this.element); }
    }

    // === ДВИЖОК ===
    class Game2048 {
        constructor() {
            this.gridSize = 4;
            this.tiles = [];
            this.score = 0;
            this.bestScore = 0;
            this.gap = 10;
            this.touchStartClientX = 0;
            this.touchStartClientY = 0;
            this.isMoving = false; // Блокировка ввода во время анимации

            this.container = document.getElementById('game-container');
            this.tileContainer = document.getElementById('tile-container');
            this.scoreEl = document.getElementById('score');
            this.bestScoreEl = document.getElementById('best-score');
            this.gameOverScreen = document.getElementById('game-over-screen');
            this.msgEl = document.getElementById('game-message');

            document.getElementById('restart-btn').addEventListener('click', () => this.restart());
            document.getElementById('retry-btn').addEventListener('click', () => this.restart());

            this.resize();
            window.addEventListener('resize', () => {
                this.resize();
                // При ресайзе обновляем позиции всех плиток мгновенно
                this.tiles.forEach(t => {
                    t.cellSize = this.cellSize;
                    t.element.style.transition = 'none'; // Отключаем анимацию при ресайзе
                    t.updatePosition();
                    // Возвращаем анимацию через тик
                    setTimeout(() => t.element.style.transition = '', 10);
                });
            });

            this.setupInput();
            this.init();
        }

        resize() {
            const width = this.container.getBoundingClientRect().width;
            this.cellSize = (width - (this.gap * (this.gridSize + 1))) / this.gridSize;
        }

        init() {
            StorageManager.getBestScore(s => {
                this.bestScore = s;
                this.bestScoreEl.innerText = s;
            });

            const saved = StorageManager.getState();
            if (saved && saved.tiles && !saved.gameOver) {
                this.restore(saved);
            } else {
                this.startNew();
            }
        }

        startNew() {
            this.tileContainer.innerHTML = '';
            this.tiles = [];
            this.score = 0;
            this.scoreEl.innerText = '0';
            this.gameOverScreen.classList.remove('active');
            this.isMoving = false;
            this.addTile();
            this.addTile();
            this.save();
        }

        restore(state) {
            this.score = state.score;
            this.scoreEl.innerText = this.score;
            this.tileContainer.innerHTML = '';
            this.tiles = [];
            this.gameOverScreen.classList.remove('active');
            if(Array.isArray(state.tiles)) {
                state.tiles.forEach(t => {
                    this.tiles.push(new Tile(this.tileContainer, t.value, t.x, t.y, this.cellSize, this.gap, 'restored'));
                });
            }
        }

        restart() {
            StorageManager.clearState();
            this.startNew();
        }

        save() {
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                this.bestScoreEl.innerText = this.bestScore;
                StorageManager.setBestScore(this.bestScore);
            }
            if (!this.gameOverScreen.classList.contains('active')) {
                StorageManager.saveState({
                    score: this.score,
                    gameOver: false,
                    tiles: this.tiles.map(t => t.serialize())
                });
            }
        }

        addTile() {
            if(this.tiles.length >= 16) return;
            const avail = [];
            for(let x=0; x<4; x++) for(let y=0; y<4; y++) {
                if(!this.tiles.find(t => t.x===x && t.y===y && !t.markedForDeletion)) avail.push({x,y});
            }
            if(avail.length) {
                const pos = avail[Math.floor(Math.random()*avail.length)];
                this.tiles.push(new Tile(this.tileContainer, Math.random()<.9?2:4, pos.x, pos.y, this.cellSize, this.gap, 'new'));
            }
        }

        move(dir) {
            if (this.isMoving || this.gameOverScreen.classList.contains('active')) return;

            const vectors = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} };
            const v = vectors[dir];
            if(!v) return;

            let moved = false;
            // Очередь для создания новых плиток ПОСЛЕ анимации
            const promotions = [];

            // Сортировка порядка обработки (чтобы плитки не перепрыгивали друг друга)
            const xs = v.x===1 ? [3,2,1,0] : [0,1,2,3];
            const ys = v.y===1 ? [3,2,1,0] : [0,1,2,3];

            // Сброс флагов слияния для этого хода
            this.tiles.forEach(t => t.mergedThisTurn = false);

            xs.forEach(x => { ys.forEach(y => {
                const t = this.tiles.find(tile => tile.x===x && tile.y===y && !tile.markedForDeletion);
                if(t) {
                    let cell = {x:t.x, y:t.y}, next;
                    // Ищем самую дальнюю свободную клетку
                    while(true) {
                        next = {x: cell.x + v.x, y: cell.y + v.y};
                        if(next.x<0 || next.x>3 || next.y<0 || next.y>3) break;

                        const other = this.tiles.find(o => o.x===next.x && o.y===next.y && !o.markedForDeletion);

                        if(other) {
                            // Если наткнулись на плитку, проверяем слияние
                            if(other.value === t.value && !other.mergedThisTurn) {
                                // === СЛИЯНИЕ ===
                                // 1. Ставим флаг, что целевая плитка уже слилась в этом ходу
                                other.mergedThisTurn = true;

                                // 2. Двигаем текущую плитку визуально в позицию 'other'
                                t.x = next.x;
                                t.y = next.y;
                                t.updatePosition();

                                // 3. Помечаем обе старые плитки на удаление
                                t.markedForDeletion = true;
                                other.markedForDeletion = true;

                                // 4. Запоминаем, что нужно создать новую плитку здесь
                                promotions.push({ x: next.x, y: next.y, value: t.value * 2 });

                                this.score += t.value * 2;
                                this.scoreEl.innerText = this.score;
                                moved = true;
                            }
                            // Если значения разные или уже было слияние - стоим перед ней
                            break;
                        }
                        cell = next;
                    }

                    // Если просто движение без слияния
                    if((cell.x !== t.x || cell.y !== t.y) && !t.markedForDeletion) {
                        t.x = cell.x;
                        t.y = cell.y;
                        t.updatePosition();
                        moved = true;
                    }
                }
            })});

            if(moved) {
                this.isMoving = true;

                // Ждем окончания анимации CSS (100ms в style.css -> берем 120ms для надежности)
                setTimeout(() => {
                    // 1. Удаляем старые плитки
                    this.tiles.forEach(t => { if(t.markedForDeletion) t.remove(); });
                    this.tiles = this.tiles.filter(t => !t.markedForDeletion);

                    // 2. Создаем новые (слитые) плитки
                    promotions.forEach(p => {
                        this.tiles.push(new Tile(this.tileContainer, p.value, p.x, p.y, this.cellSize, this.gap, 'merged'));
                    });

                    // 3. Добавляем новую случайную плитку
                    this.addTile();

                    // 4. Сохраняем и разблокируем
                    this.save();
                    this.isMoving = false;

                    if(!this.movesAvailable()) {
                        this.msgEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
                        this.gameOverScreen.classList.add('active');
                        StorageManager.clearState();
                    }
                }, 120);
            }
        }

        movesAvailable() {
            if(this.tiles.length < 16) return true;
            for(let t of this.tiles) {
                for(let d of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) {
                    const v = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} }[d];
                    const o = this.tiles.find(k => k.x === t.x + v.x && k.y === t.y + v.y && !k.markedForDeletion);
                    if(o && o.value === t.value) return true;
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

            const c = this.container;
            c.addEventListener('touchstart', e => {
                if (e.touches.length > 1) return;
                this.touchStartClientX = e.touches[0].clientX;
                this.touchStartClientY = e.touches[0].clientY;
            }, {passive: false});

            c.addEventListener('touchmove', e => e.preventDefault(), {passive: false});

            c.addEventListener('touchend', e => {
                if (!this.touchStartClientX || !this.touchStartClientY) return;
                const dx = e.changedTouches[0].clientX - this.touchStartClientX;
                const dy = e.changedTouches[0].clientY - this.touchStartClientY;

                if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
                    if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
                    else this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
                }
                this.touchStartClientX = null;
                this.touchStartClientY = null;
            });
        }
    }

    new Game2048();
});