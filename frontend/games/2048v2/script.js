document.addEventListener('DOMContentLoaded', () => {
    // === СИСТЕМА ЛОГОВ (ЧТОБЫ ВИДЕТЬ ОШИБКИ НА ЭКРАНЕ) ===
    const debugEl = document.createElement('div');
    debugEl.style.cssText = "position:absolute; bottom:5px; left:0; width:100%; text-align:center; font-size:10px; color:#aaa; pointer-events:none;";
    debugEl.id = 'debug-log';
    document.body.appendChild(debugEl);

    function loadScoreFromCloud() {
    tg.CloudStorage.getItem('best_score_2048', (err, value) => {
        if (!err && value) {
            const cloudScore = parseInt(value);
            // Здесь код, который устанавливает рекорд в интерфейс игры
            console.log("Рекорд из облака:", cloudScore);
        }
    });
}

    function log(msg) {
        console.log('[2048]', msg);
        const el = document.getElementById('debug-log');
        if(el) el.innerText = msg;
    }

    // === БЕЗОПАСНОЕ ХРАНИЛИЩЕ ===
    // Мы пытаемся использовать localStorage Родителя (Game Center), так как он не стирается
    let safeStorage;
    let tg;

    try {
        // Пробуем взять контекст родительского окна (Game Center)
        if (window.parent && window.parent.localStorage) {
            safeStorage = window.parent.localStorage;
            log('Storage: Parent linked');
        } else {
            safeStorage = window.localStorage;
            log('Storage: Iframe local');
        }

        // Пробуем взять Telegram SDK из родителя, чтобы CloudStorage точно работал
        if (window.parent && window.parent.Telegram && window.parent.Telegram.WebApp) {
            tg = window.parent.Telegram.WebApp;
        } else {
            tg = window.Telegram.WebApp;
        }

        if (tg) {
            tg.ready();
            // expand не нужен, если мы в iframe, но на всякий случай
            if(tg.expand) tg.expand();
        }

    } catch (e) {
        log('Error init: ' + e.message);
        safeStorage = window.localStorage;
        tg = window.Telegram.WebApp;
    }

    // Ключи
    const KEYS = {
        BEST_SCORE: '2048_v2_best',
        GAME_STATE: '2048_v2_state'
    };

    const StorageManager = {
        // Сохранение рекорда (Синхронно в Local + Асинхронно в Cloud)
        setBestScore(score) {
            try {
                // 1. Быстро пишем в локалку
                safeStorage.setItem(KEYS.BEST_SCORE, score);

                // 2. Отправляем в облако (если есть доступ)
                if (window.parent) {
                        window.parent.postMessage({
                            type: 'save_score',
                            game: '2048', // id игры
                            value: score
                        }, '*');
                    }
                }
            } catch (e) {
                log('Save Score Fail: ' + e.message);
            }
        },

        // Получение рекорда
        getBestScore(callback) {
            try {
                // 1. Сразу берем из локалки
                const local = parseInt(safeStorage.getItem(KEYS.BEST_SCORE)) || 0;
                callback(local);

                // 2. Чекаем облако
                if (tg && tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                    tg.CloudStorage.getItem(KEYS.BEST_SCORE, (err, val) => {
                        if (!err && val) {
                            const cloudVal = parseInt(val);
                            if (cloudVal > local) {
                                safeStorage.setItem(KEYS.BEST_SCORE, cloudVal);
                                callback(cloudVal);
                                log('Synced from Cloud');
                            }
                        }
                    });
                }
            } catch (e) {
                log('Get Score Fail: ' + e.message);
                callback(0);
            }
        },

        saveState(state) {
            try {
                safeStorage.setItem(KEYS.GAME_STATE, JSON.stringify(state));
                log('State Saved: ' + state.score);
            } catch (e) {
                log('Save State Fail: ' + e.message);
            }
        },

        getState() {
            try {
                const s = safeStorage.getItem(KEYS.GAME_STATE);
                return s ? JSON.parse(s) : null;
            } catch (e) {
                return null;
            }
        },

        clearState() {
            try {
                safeStorage.removeItem(KEYS.GAME_STATE);
                log('State Cleared');
            } catch(e) {}
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
                this.tiles.forEach(t => { t.cellSize = this.cellSize; t.updatePosition(); });
            });

            this.setupInput();
            this.init();
        }

        resize() {
            const width = this.container.clientWidth;
            this.cellSize = (width - (this.gap * 2) - (this.gap * (this.gridSize - 1))) / this.gridSize;
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
            state.tiles.forEach(t => {
                this.tiles.push(new Tile(this.tileContainer, t.value, t.x, t.y, this.cellSize, this.gap, true));
            });
            log('Game Restored');
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
            if(this.tiles.length>=16) return;
            const avail = [];
            for(let x=0;x<4;x++) for(let y=0;y<4;y++)
                if(!this.tiles.find(t=>t.x===x && t.y===y && !t.mergedToRemove)) avail.push({x,y});

            if(avail.length) {
                const pos = avail[Math.floor(Math.random()*avail.length)];
                this.tiles.push(new Tile(this.tileContainer, Math.random()<.9?2:4, pos.x, pos.y, this.cellSize, this.gap));
            }
        }

        move(dir) {
            if (this.gameOverScreen.classList.contains('active')) return;

            const vecs = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} };
            const v = vecs[dir];
            if(!v) return;

            let moved = false;
            this.tiles.forEach(t => t.mergedFrom = null);

            const xs = v.x===1?[3,2,1,0]:[0,1,2,3];
            const ys = v.y===1?[3,2,1,0]:[0,1,2,3];

            xs.forEach(x => { ys.forEach(y => {
                const t = this.tiles.find(tile => tile.x===x && tile.y===y && !tile.mergedToRemove);
                if(t) {
                    let cell = {x:t.x, y:t.y}, next;
                    while(true) {
                        next = {x:cell.x+v.x, y:cell.y+v.y};
                        if(next.x<0||next.x>3||next.y<0||next.y>3) break;
                        const other = this.tiles.find(o => o.x===next.x && o.y===next.y && !o.mergedToRemove);
                        if(other) {
                            if(other.value===t.value && !other.mergedFrom) {
                                const merged = new Tile(this.tileContainer, t.value*2, next.x, next.y, this.cellSize, this.gap);
                                merged.element.classList.add('tile-merged');
                                merged.mergedFrom=true;
                                t.mergedToRemove=true; other.mergedToRemove=true;
                                t.element.style.zIndex=100; t.x=next.x; t.y=next.y; t.updatePosition();
                                this.tiles.push(merged);
                                this.score+=merged.value;
                                this.scoreEl.innerText = this.score;
                                moved=true;
                            }
                            break;
                        }
                        cell=next;
                    }
                    if((cell.x!==t.x||cell.y!==t.y)&&!t.mergedToRemove) {
                        t.x=cell.x; t.y=cell.y; t.updatePosition(); moved=true;
                    }
                }
            })});

            if(moved) {
                setTimeout(() => {
                    this.tiles.forEach(t=>{if(t.mergedToRemove)t.remove()});
                    this.tiles=this.tiles.filter(t=>!t.mergedToRemove);
                    this.addTile();
                    this.save(); // Сохраняем после хода
                    if(!this.movesAvailable()) {
                        this.msgEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
                        this.gameOverScreen.classList.add('active');
                        StorageManager.clearState();
                    }
                }, 100);
            }
        }

        movesAvailable() {
            if(this.tiles.length<16) return true;
            for(let t of this.tiles) {
                for(let d of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) {
                    const v = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} }[d];
                    const o = this.tiles.find(k => k.x===t.x+v.x && k.y===t.y+v.y && !k.mergedToRemove);
                    if(o && o.value===t.value) return true;
                }
            }
            return false;
        }

        setupInput() {
            document.addEventListener('keydown', e => {
                if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
                    e.preventDefault(); this.move(e.key);
                }
            });
            let sx, sy;
            const c = this.container;
            c.addEventListener('touchstart', e => { sx=e.touches[0].clientX; sy=e.touches[0].clientY; }, {passive:false});
            c.addEventListener('touchmove', e => e.preventDefault(), {passive:false});
            c.addEventListener('touchend', e => {
                if(!sx||!sy) return;
                const dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy;
                if(Math.max(Math.abs(dx),Math.abs(dy))>30) {
                    if(Math.abs(dx)>Math.abs(dy)) this.move(dx>0?'ArrowRight':'ArrowLeft');
                    else this.move(dy>0?'ArrowDown':'ArrowUp');
                }
                sx=null; sy=null;
            });
        }
    }

    new Game2048();
});