document.addEventListener('DOMContentLoaded', () => {
    // === СИСТЕМА ЛОГОВ ===
    const debugEl = document.createElement('div');
    debugEl.style.cssText = "position:absolute; bottom:5px; left:0; width:100%; text-align:center; font-size:10px; color:#aaa; pointer-events:none; z-index:9999;";
    debugEl.id = 'debug-log';
    document.body.appendChild(debugEl);

    function log(msg) {
        console.log('[2048]', msg);
        if(debugEl) debugEl.innerText = msg;
    }

    // === ИНИЦИАЛИЗАЦИЯ TELEGRAM ===
    let tg = window.Telegram.WebApp;
    let safeStorage = window.localStorage;

    try {
        tg.ready();
        log('TG Init: OK');
    } catch (e) {
        log('TG Init Error: ' + e.message);
    }

    // Ключи (должны быть: a-z, 0-9, _, -)
    const KEYS = {
        BEST_SCORE: '2048_best_score',
        GAME_STATE: '2048_game_state'
    };

    const StorageManager = {
        // --- СОХРАНЕНИЕ РЕКОРДА ---
        setBestScore(score) {
            const scoreStr = score.toString();

            // 1. Сохраняем локально (моментально)
            try {
                safeStorage.setItem(KEYS.BEST_SCORE, scoreStr);
            } catch (e) { console.error(e); }

            // 2. Сохраняем в облако (если доступно)
            if (tg && tg.CloudStorage) {
                tg.CloudStorage.setItem(KEYS.BEST_SCORE, scoreStr, (err, saved) => {
                    if (err) {
                        log('Cloud Save ERR: ' + JSON.stringify(err));
                    } else {
                        // Если успешно - ничего не пишем, чтобы не засорять экран
                        if (saved) console.log('Cloud Saved');
                    }
                });
            } else {
                log('Cloud Not Available');
            }
        },

        // --- ПОЛУЧЕНИЕ РЕКОРДА ---
        getBestScore(callback) {
            // 1. Сначала берем из локалки и сразу отдаем игре
            let localScore = 0;
            try {
                localScore = parseInt(safeStorage.getItem(KEYS.BEST_SCORE)) || 0;
            } catch (e) {}

            // Вызываем коллбек сразу, чтобы интерфейс не ждал
            callback(localScore);

            // 2. Проверяем облако
            if (tg && tg.CloudStorage) {
                tg.CloudStorage.getItem(KEYS.BEST_SCORE, (err, value) => {
                    if (err) {
                        log('Cloud Get ERR: ' + JSON.stringify(err));
                        return;
                    }

                    if (value) {
                        const cloudScore = parseInt(value) || 0;

                        // ЛОГИКА СИНХРОНИЗАЦИИ
                        if (cloudScore > localScore) {
                            // В облаке рекорд выше -> обновляем локалку и игру
                            log('Synced from Cloud: ' + cloudScore);
                            safeStorage.setItem(KEYS.BEST_SCORE, cloudScore);
                            callback(cloudScore);
                        } else if (localScore > cloudScore) {
                            // Локально рекорд выше (играли без инета) -> пушим в облако
                            log('Pushing Local to Cloud');
                            this.setBestScore(localScore);
                        }
                    } else {
                        // В облаке пусто, но у нас есть локальный рекорд -> сохраняем его туда
                        if (localScore > 0) {
                            this.setBestScore(localScore);
                        }
                    }
                });
            }
        },

        // --- СОХРАНЕНИЕ СОСТОЯНИЯ (только LocalStorage) ---
        // Состояние доски слишком большое для CloudStorage (там лимиты жесткие),
        // поэтому храним его только локально.
        saveState(state) {
            try {
                safeStorage.setItem(KEYS.GAME_STATE, JSON.stringify(state));
            } catch (e) {}
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
        constructor(container, value, x, y, cellSize, gap, isRestored = false) {
            this.container = container;
            this.value = value;
            this.x = x;
            this.y = y;
            this.cellSize = cellSize;
            this.gap = gap;
            this.mergedToRemove = false;
            this.mergedFrom = null; // Fix: добавлено свойство

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
            // Обновляем классы для цвета при изменении значения
            this.element.className = `tile tile-${this.value <= 2048 ? this.value : 'super'} ${this.mergedToRemove ? 'tile-merged' : ''}`;
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

            this.container = document.getElementById('game-container');
            this.tileContainer = document.getElementById('tile-container');
            this.scoreEl = document.getElementById('score');
            this.bestScoreEl = document.getElementById('best-score');
            this.gameOverScreen = document.getElementById('game-over-screen');
            this.msgEl = document.getElementById('game-message');

            document.getElementById('restart-btn').addEventListener('click', () => this.restart());
            document.getElementById('retry-btn').addEventListener('click', () => this.restart());

            // Инициализация размеров
            this.resize();
            window.addEventListener('resize', () => {
                this.resize();
                this.tiles.forEach(t => { t.cellSize = this.cellSize; t.updatePosition(); });
            });

            this.setupInput();
            this.init();
        }

        resize() {
            // Исправлен расчет ширины
            const width = this.container.getBoundingClientRect().width;
            this.cellSize = (width - (this.gap * (this.gridSize + 1))) / this.gridSize;
        }

        init() {
            // Загрузка рекорда (локально -> затем облако)
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
                    this.tiles.push(new Tile(this.tileContainer, t.value, t.x, t.y, this.cellSize, this.gap, true));
                });
            }
            log('Restored Local');
        }

        restart() {
            StorageManager.clearState();
            this.startNew();
        }

        save() {
            // Проверка на рекорд
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                this.bestScoreEl.innerText = this.bestScore;
                StorageManager.setBestScore(this.bestScore);
            }

            // Сохранение состояния доски
            if (this.gameOverScreen.classList.contains('active')) {
                StorageManager.clearState();
            } else {
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
            for(let x=0; x<4; x++) {
                for(let y=0; y<4; y++) {
                    if(!this.tiles.find(t => t.x===x && t.y===y && !t.mergedToRemove)) {
                        avail.push({x,y});
                    }
                }
            }

            if(avail.length) {
                const pos = avail[Math.floor(Math.random()*avail.length)];
                this.tiles.push(new Tile(this.tileContainer, Math.random() < 0.9 ? 2 : 4, pos.x, pos.y, this.cellSize, this.gap));
            }
        }

        move(dir) {
            if (this.gameOverScreen.classList.contains('active')) return;

            const vecs = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} };
            const v = vecs[dir];
            if(!v) return;

            let moved = false;
            // Сброс флагов слияния перед ходом
            this.tiles.forEach(t => t.mergedFrom = null);

            const xs = v.x===1 ? [3,2,1,0] : [0,1,2,3];
            const ys = v.y===1 ? [3,2,1,0] : [0,1,2,3];

            xs.forEach(x => { ys.forEach(y => {
                const t = this.tiles.find(tile => tile.x===x && tile.y===y && !tile.mergedToRemove);
                if(t) {
                    let cell = {x:t.x, y:t.y}, next;
                    while(true) {
                        next = {x: cell.x + v.x, y: cell.y + v.y};
                        if(next.x<0 || next.x>3 || next.y<0 || next.y>3) break;

                        const other = this.tiles.find(o => o.x===next.x && o.y===next.y && !o.mergedToRemove);
                        if(other) {
                            if(other.value === t.value && !other.mergedFrom) {
                                // Слияние
                                const merged = new Tile(this.tileContainer, t.value*2, next.x, next.y, this.cellSize, this.gap);
                                merged.mergedFrom = true;

                                t.mergedToRemove = true;
                                other.mergedToRemove = true;

                                // Анимация перемещения старой плитки в точку слияния
                                t.element.style.zIndex = 100;
                                t.x = next.x;
                                t.y = next.y;
                                t.updatePosition();

                                this.tiles.push(merged);
                                this.score += merged.value;
                                this.scoreEl.innerText = this.score;
                                moved = true;
                            }
                            break; // Столкнулись, дальше нельзя
                        }
                        cell = next;
                    }
                    if((cell.x !== t.x || cell.y !== t.y) && !t.mergedToRemove) {
                        t.x = cell.x;
                        t.y = cell.y;
                        t.updatePosition();
                        moved = true;
                    }
                }
            })});

            if(moved) {
                // Ждем окончания анимации
                setTimeout(() => {
                    this.tiles.forEach(t => { if(t.mergedToRemove) t.remove(); });
                    this.tiles = this.tiles.filter(t => !t.mergedToRemove);

                    this.addTile();
                    this.save();

                    if(!this.movesAvailable()) {
                        this.msgEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
                        this.gameOverScreen.classList.add('active');
                        StorageManager.clearState();
                    }
                }, 150); // Чуть увеличил время для плавности
            }
        }

        movesAvailable() {
            if(this.tiles.length < 16) return true;
            for(let t of this.tiles) {
                for(let d of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) {
                    const v = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} }[d];
                    const o = this.tiles.find(k => k.x === t.x + v.x && k.y === t.y + v.y && !k.mergedToRemove);
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
                if (e.touches.length > 1) return; // Игнорируем мультитач
                this.touchStartClientX = e.touches[0].clientX;
                this.touchStartClientY = e.touches[0].clientY;
            }, {passive: false});

            c.addEventListener('touchmove', e => {
                e.preventDefault(); // Блокируем скролл страницы при свайпе
            }, {passive: false});

            c.addEventListener('touchend', e => {
                if (!this.touchStartClientX || !this.touchStartClientY) return;

                const dx = e.changedTouches[0].clientX - this.touchStartClientX;
                const dy = e.changedTouches[0].clientY - this.touchStartClientY;

                // Минимальная длина свайпа
                if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
                    if (Math.abs(dx) > Math.abs(dy)) {
                        this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
                    } else {
                        this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
                    }
                }

                this.touchStartClientX = null;
                this.touchStartClientY = null;
            });
        }
    }

    new Game2048();
});