document.addEventListener('DOMContentLoaded', () => {
    // === СИСТЕМА ЛОГОВ (ОПЦИОНАЛЬНО) ===
    // Можно включить для отладки на телефоне, раскомментировав
    /*
    const debugEl = document.createElement('div');
    debugEl.style.cssText = "position:absolute; bottom:5px; left:0; width:100%; text-align:center; font-size:10px; color:#aaa; pointer-events:none; z-index:9999;";
    debugEl.id = 'debug-log';
    document.body.appendChild(debugEl);
    */

    function log(msg) {
        console.log('[2048 Cloud]', msg);
        // const el = document.getElementById('debug-log');
        // if(el) el.innerText = msg;
    }

    // === ИНИЦИАЛИЗАЦИЯ TELEGRAM SDK ===
    let tg = window.Telegram.WebApp;
    let cloudStorage = null;

    try {
        // Попытка получить SDK из родителя (так как мы в iframe)
        if (window.parent && window.parent.Telegram && window.parent.Telegram.WebApp) {
            tg = window.parent.Telegram.WebApp;
            log('TG SDK: Loaded from Parent');
        } else {
            log('TG SDK: Loaded form Local');
        }

        if (tg) {
            tg.ready();
            // Проверяем доступность CloudStorage
            if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                cloudStorage = tg.CloudStorage;
                log('CloudStorage: Available');
            } else {
                log('CloudStorage: Not supported or old version');
            }
        }
    } catch (e) {
        log('TG Init Error: ' + e.message);
    }

    // Ключи для хранения
    const KEYS = {
        BEST_SCORE: '2048_best_score_v1', // Уникальный ключ
        GAME_STATE: '2048_game_state_v1'
    };

    const StorageManager = {
        // Сохранение рекорда (Локально + Облако)
        setBestScore(score) {
            const scoreStr = score.toString();

            // 1. Локальное сохранение (мгновенно)
            try {
                localStorage.setItem(KEYS.BEST_SCORE, scoreStr);
            } catch (e) {}

            // 2. Облачное сохранение (асинхронно)
            if (cloudStorage) {
                cloudStorage.setItem(KEYS.BEST_SCORE, scoreStr, (err, stored) => {
                    if (err) {
                        log('Cloud Save Error: ' + err);
                    } else {
                        log('Cloud Saved: ' + scoreStr);
                    }
                });
            }
        },

        // Получение рекорда (Синхронизация)
        getBestScore(callback) {
            // 1. Сначала берем то, что есть локально
            let localScore = 0;
            try {
                localScore = parseInt(localStorage.getItem(KEYS.BEST_SCORE)) || 0;
            } catch (e) {}

            // Сразу отдаем локальный результат, чтобы интерфейс не ждал
            callback(localScore);

            // 2. Если есть облако, проверяем его
            if (cloudStorage) {
                cloudStorage.getItem(KEYS.BEST_SCORE, (err, value) => {
                    if (!err && value) {
                        const cloudScore = parseInt(value);
                        log(`Sync Check: Local=${localScore}, Cloud=${cloudScore}`);

                        if (cloudScore > localScore) {
                            // В облаке рекорд выше -> обновляем локалку и UI
                            localStorage.setItem(KEYS.BEST_SCORE, cloudScore);
                            callback(cloudScore);
                            log('Synced from Cloud (Updated UI)');
                        } else if (localScore > cloudScore) {
                            // Локальный рекорд выше (играли оффлайн) -> пушим в облако
                            cloudStorage.setItem(KEYS.BEST_SCORE, localScore.toString());
                            log('Synced to Cloud (Push local record)');
                        }
                    } else {
                        // Если в облаке пусто, но локально есть рекорд -> сохраняем в облако
                        if (localScore > 0) {
                            cloudStorage.setItem(KEYS.BEST_SCORE, localScore.toString());
                        }
                    }
                });
            }
        },

        // Сохранение состояния игры (поле, плитки) - только локально (слишком много данных для облака)
        saveState(state) {
            try {
                localStorage.setItem(KEYS.GAME_STATE, JSON.stringify(state));
            } catch (e) {}
        },

        getState() {
            try {
                const s = localStorage.getItem(KEYS.GAME_STATE);
                return s ? JSON.parse(s) : null;
            } catch (e) {
                return null;
            }
        },

        clearState() {
            try {
                localStorage.removeItem(KEYS.GAME_STATE);
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
            // Загружаем рекорд (сначала локально, потом подтянется облако)
            StorageManager.getBestScore(s => {
                this.bestScore = s;
                this.bestScoreEl.innerText = s;
                // Если текущий счет вдруг больше рекорда (баг), поправим
                if (this.score > this.bestScore) {
                     StorageManager.setBestScore(this.score);
                }
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
            log('Game Restored from State');
        }

        restart() {
            StorageManager.clearState();
            this.startNew();
        }

        save() {
            // Проверка рекорда
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
                    this.save(); // Сохраняем прогресс и рекорд
                    if(!this.movesAvailable()) {
                        this.msgEl.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
                        this.gameOverScreen.classList.add('active');
                        StorageManager.clearState();
                        // Финальная попытка сохранить рекорд
                        if (this.score > this.bestScore) StorageManager.setBestScore(this.score);
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