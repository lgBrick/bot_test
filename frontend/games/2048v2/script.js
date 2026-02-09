document.addEventListener('DOMContentLoaded', () => {
    // === ИНИЦИАЛИЗАЦИЯ TELEGRAM SDK ===
    let tg = window.Telegram.WebApp;
    let cloudStorage = null;

    try {
        if (window.parent && window.parent.Telegram && window.parent.Telegram.WebApp) {
            tg = window.parent.Telegram.WebApp;
        }
        if (tg) {
            tg.ready();
            tg.expand();
            // Проверка CloudStorage
            if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                cloudStorage = tg.CloudStorage;
                console.log('CloudStorage: Available');
            }
        }
    } catch (e) {
        console.log('TG Init Error:', e);
    }

    // === КОНСТАНТЫ ===
    const KEYS = {
        BEST_SCORE: '2048_tg_best_v2', // v2 чтобы не конфликтовать со старыми
        GAME_STATE: '2048_tg_state_v2'
    };

    window.reset2048Progress = function(callback) {
        console.log('[2048] Resetting progress...');

        // 1. Очистка LocalStorage
        localStorage.removeItem(KEYS.BEST_SCORE);
        localStorage.removeItem(KEYS.GAME_STATE);

        // 2. Очистка CloudStorage
        if (cloudStorage) {
            cloudStorage.removeItems([KEYS.BEST_SCORE, KEYS.GAME_STATE], (err) => {
                if (err) console.error('Cloud clear error:', err);
                if (callback) callback();
            });
        } else {
            if (callback) callback();
        }

        // Обнуление UI если нужно (можно просто перезагрузить страницу)
        const bestScoreEl = document.getElementById('menu-best-score');
        if(bestScoreEl) bestScoreEl.innerText = '0';
    };

    // === UI Elements ===
    const UI = {
        screens: {
            menu: document.getElementById('menu-screen'),
            game: document.getElementById('game-screen')
        },
        menu: {
            bestScore: document.getElementById('menu-best-score'),
            btnContinue: document.getElementById('btn-continue'),
            btnNew: document.getElementById('btn-new-game'),
            btnHelp: document.getElementById('btn-help')
        },
        game: {
            container: document.getElementById('game-container'),
            tileContainer: document.getElementById('tile-container'),
            score: document.getElementById('game-score'),
            bestScore: document.getElementById('game-best-score'),
            gameOver: document.getElementById('game-over-screen'),
            msg: document.getElementById('game-message'),
            btnBack: document.getElementById('btn-back'),
            btnRestart: document.getElementById('btn-game-restart'),
            btnRetry: document.getElementById('btn-retry')
        },
        help: {
            overlay: document.getElementById('help-overlay'),
            closeBtn: document.getElementById('help-close-btn')
        }
    };

    // === STORAGE MANAGER (С ОБЛАКОМ) ===
    const StorageManager = {
        // Получить локальный рекорд
        getLocalBest() {
            return parseInt(localStorage.getItem(KEYS.BEST_SCORE)) || 0;
        },

        // Сохранить рекорд (Локально + Облако)
        setBestScore(score) {
            const current = this.getLocalBest();
            if (score > current) {
                // 1. Локально
                localStorage.setItem(KEYS.BEST_SCORE, score);

                // 2. Облако
                if (cloudStorage) {
                    cloudStorage.setItem(KEYS.BEST_SCORE, score.toString(), (err) => {
                        if(!err) console.log('Cloud Saved:', score);
                    });
                }
            }
        },

        // Синхронизация при старте
        sync(callback) {
            const local = this.getLocalBest();
            // Сразу показываем локальный
            if(callback) callback(local);

            if (cloudStorage) {
                cloudStorage.getItem(KEYS.BEST_SCORE, (err, val) => {
                    if (!err && val) {
                        const cloudVal = parseInt(val);
                        console.log(`Sync: Local=${local}, Cloud=${cloudVal}`);

                        if (cloudVal > local) {
                            // Облако круче -> обновляем локалку
                            localStorage.setItem(KEYS.BEST_SCORE, cloudVal);
                            if(callback) callback(cloudVal);
                        } else if (local > cloudVal) {
                            // Локалка круче -> пушим в облако
                            cloudStorage.setItem(KEYS.BEST_SCORE, local.toString());
                        }
                    } else if (!err && !val && local > 0) {
                         // В облаке пусто, а локально есть -> пушим
                         cloudStorage.setItem(KEYS.BEST_SCORE, local.toString());
                    }
                });
            }
        },

        getState() {
            try {
                const s = localStorage.getItem(KEYS.GAME_STATE);
                return s ? JSON.parse(s) : null;
            } catch (e) { return null; }
        },
        saveState(state) {
            localStorage.setItem(KEYS.GAME_STATE, JSON.stringify(state));
        },
        clearState() {
            localStorage.removeItem(KEYS.GAME_STATE);
        }
    };

    // === КЛАСС ПЛИТКИ ===
    class Tile {
        constructor(container, value, x, y, cellSize, gap, isRestored = false, isMerged = false) {
            this.container = container;
            this.value = value;
            this.x = x;
            this.y = y;
            this.cellSize = cellSize;
            this.gap = gap;
            this.mergedToRemove = false;
            this.mergedFrom = null;

            this.element = document.createElement('div');
            this.element.className = `tile tile-${value <= 2048 ? value : 'super'}`;

            if (!isRestored && !isMerged) {
                this.element.classList.add('tile-new');
            }

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
            this.element.style.transform = `translate3d(${xPx}px, ${yPx}px, 0)`;
        }

        serialize() { return { x: this.x, y: this.y, value: this.value }; }
        remove() { if(this.element.parentNode) this.element.parentNode.removeChild(this.element); }
    }

    // === ДВИЖОК ИГРЫ ===
    class Game2048 {
        constructor() {
            this.gridSize = 4;
            this.tiles = [];
            this.score = 0;
            this.gap = 10;
            this.cellSize = 0;
            this.isAnimating = false;

            this.resize();
            window.addEventListener('resize', () => this.handleResize());
            this.setupInput();
        }

        handleResize() {
            this.resize();
            this.tiles.forEach(t => {
                t.cellSize = this.cellSize;
                t.updatePosition();
            });
        }

        resize() {
            const containerWidth = Math.min(window.innerWidth - 40, 400);
            UI.game.container.style.width = `${containerWidth}px`;
            UI.game.container.style.height = `${containerWidth}px`;
            document.documentElement.style.setProperty('--grid-size', `${containerWidth}px`);
            this.cellSize = (containerWidth - (this.gap * 2) - (this.gap * (this.gridSize - 1))) / this.gridSize;
        }

        startNew() {
            StorageManager.clearState();
            this.score = 0;
            this.tiles = [];
            UI.game.tileContainer.innerHTML = '';
            UI.game.gameOver.classList.remove('active');

            this.updateScoreUI();
            this.addTile();
            this.addTile();
            this.save();
        }

        restore() {
            const saved = StorageManager.getState();
            if (!saved) {
                this.startNew();
                return;
            }
            this.score = saved.score;
            this.tiles = [];
            UI.game.tileContainer.innerHTML = '';
            UI.game.gameOver.classList.remove('active');
            saved.tiles.forEach(t => {
                this.tiles.push(new Tile(UI.game.tileContainer, t.value, t.x, t.y, this.cellSize, this.gap, true));
            });
            this.updateScoreUI();
        }

        addTile() {
            if(this.tiles.length >= 16) return;
            const avail = [];
            for(let x=0; x<4; x++) for(let y=0; y<4; y++)
                if(!this.tiles.find(t=>t.x===x && t.y===y && !t.mergedToRemove)) avail.push({x,y});

            if(avail.length) {
                const pos = avail[Math.floor(Math.random()*avail.length)];
                this.tiles.push(new Tile(UI.game.tileContainer, Math.random()<.9?2:4, pos.x, pos.y, this.cellSize, this.gap));
            }
        }

        move(dir) {
            if (UI.screens.game.classList.contains('hidden') ||
                UI.game.gameOver.classList.contains('active') ||
                UI.help.overlay.classList.contains('active') || // Блок если открыта помощь
                !UI.help.overlay.classList.contains('hidden') ||
                this.isAnimating) return;

            const vecs = { 'ArrowUp':{x:0,y:-1}, 'ArrowDown':{x:0,y:1}, 'ArrowLeft':{x:-1,y:0}, 'ArrowRight':{x:1,y:0} };
            const v = vecs[dir];
            if(!v) return;

            let moved = false;
            this.tiles.forEach(t => { t.mergedFrom = null; t.element.classList.remove('tile-merged'); });

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
                                const merged = new Tile(UI.game.tileContainer, t.value*2, next.x, next.y, this.cellSize, this.gap, false, true);
                                merged.element.style.opacity = '0';
                                merged.mergedFrom = true;
                                t.mergedToRemove = true;
                                other.mergedToRemove = true;
                                t.element.style.zIndex = 100;
                                t.x = next.x; t.y = next.y;
                                t.updatePosition();
                                this.tiles.push(merged);
                                this.score += merged.value;
                                moved = true;
                            }
                            break;
                        }
                        cell = next;
                    }
                    if((cell.x!==t.x || cell.y!==t.y) && !t.mergedToRemove) {
                        t.x = cell.x; t.y = cell.y; t.updatePosition(); moved = true;
                    }
                }
            })});

            if(moved) {
                this.isAnimating = true;
                this.updateScoreUI();
                setTimeout(() => {
                    this.tiles.forEach(t => { if(t.mergedToRemove) t.remove() });
                    this.tiles = this.tiles.filter(t => !t.mergedToRemove);
                    this.tiles.forEach(t => {
                        if (t.mergedFrom) {
                            t.element.style.opacity = '1';
                            void t.element.offsetWidth;
                            t.element.classList.add('tile-merged');
                        }
                    });
                    this.addTile();
                    this.save();
                    this.isAnimating = false;
                    if(!this.movesAvailable()) this.gameOver();
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

        updateScoreUI() {
            UI.game.score.innerText = this.score;
            StorageManager.setBestScore(this.score);
            UI.game.bestScore.innerText = Math.max(this.score, StorageManager.getLocalBest());
        }

        save() {
            StorageManager.saveState({
                score: this.score,
                tiles: this.tiles.map(t => t.serialize())
            });
        }

        gameOver() {
            UI.game.msg.innerHTML = `Игра окончена!<br>Счет: ${this.score}`;
            UI.game.gameOver.classList.add('active');
            StorageManager.clearState();
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
        }

        setupInput() {
            document.addEventListener('keydown', e => {
                // Карта клавиш: Стрелки + WASD (по физическому коду клавиши)
                const map = {
                    'ArrowUp': 'ArrowUp',    'KeyW': 'ArrowUp',
                    'ArrowDown': 'ArrowDown',  'KeyS': 'ArrowDown',
                    'ArrowLeft': 'ArrowLeft',  'KeyA': 'ArrowLeft',
                    'ArrowRight': 'ArrowRight', 'KeyD': 'ArrowRight'
                };

                const direction = map[e.code]; // Используем e.code для независимости от раскладки

                if (direction) {
                    e.preventDefault();
                    this.move(direction);
                }

                if (e.code === 'KeyR') {
                    this.startNew();
                }
            });

            let sx, sy;
            const c = UI.game.container;
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

    // === КОНТРОЛЛЕР ===
    const game = new Game2048();

    function updateMenuBestScore() {
        // Запускаем синхронизацию и обновляем UI
        StorageManager.sync((val) => {
            UI.menu.bestScore.innerText = val;
            UI.game.bestScore.innerText = val;
        });
    }

    function showMenu() {
        UI.screens.game.classList.add('hidden');
        UI.screens.menu.classList.remove('hidden');
        updateMenuBestScore();
        const state = StorageManager.getState();
        UI.menu.btnContinue.disabled = !state;
    }

    function showGame(isNew) {
        UI.screens.menu.classList.add('hidden');
        UI.screens.game.classList.remove('hidden');
        game.resize();
        if (isNew) game.startNew();
        else game.restore();
    }

    // Обработчики кнопок
    UI.menu.btnNew.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        showGame(true);
    });

    UI.menu.btnContinue.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        showGame(false);
    });

    // HELP LOGIC
    UI.menu.btnHelp.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        UI.help.overlay.classList.remove('hidden');
    });

    UI.help.closeBtn.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        UI.help.overlay.classList.add('hidden');
    });

    // Кнопки в игре
    UI.game.btnBack.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        showMenu();
    });

    UI.game.btnRestart.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
        tg.showConfirm('Начать новую игру?', (ok) => { if(ok) game.startNew(); });
    });

    UI.game.btnRetry.addEventListener('click', () => {
        if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
        game.startNew();
    });

    // Старт
    showMenu();
});