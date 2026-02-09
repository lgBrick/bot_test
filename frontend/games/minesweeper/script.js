document.addEventListener('DOMContentLoaded', () => {
    // === СИСТЕМА ЛОГОВ (Для отладки) ===
    function log(msg) {
        console.log('[Minesweeper Cloud]', msg);
    }

    // === ИНИЦИАЛИЗАЦИЯ TELEGRAM SDK ===
    let tg = window.Telegram.WebApp;
    let cloudStorage = null;

    try {
        if (window.parent && window.parent.Telegram && window.parent.Telegram.WebApp) {
            tg = window.parent.Telegram.WebApp;
            log('TG SDK: Loaded from Parent');
        } else {
            log('TG SDK: Loaded from Local');
        }

        if (tg) {
            tg.ready();
            if (tg.expand) tg.expand();
            if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

            if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                cloudStorage = tg.CloudStorage;
                log('CloudStorage: Available');
            } else {
                log('CloudStorage: Not supported');
            }
        }
    } catch (e) {
        log('Init Error: ' + e.message);
    }

    function haptic(type) {
        if (!tg.HapticFeedback) return;
        try {
            if (type === 'light') tg.HapticFeedback.impactOccurred('light');
            if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
            if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
            if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
            if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
            if (type === 'selection') tg.HapticFeedback.selectionChanged();
        } catch(e) {}
    }

    // Вспомогательная функция форматирования времени (MM:SS.ms)
    function formatTime(ms) {
        if (ms === null || ms === undefined || isNaN(ms) || ms === Infinity) return '--:--';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        const centis = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
        return `${minutes}:${seconds}.${centis}`;
    }

    const PRESETS = {
        beginner: { rows: 9, cols: 9, mines: 10 },
        amateur: { rows: 16, cols: 16, mines: 40 },
        expert: { rows: 16, cols: 30, mines: 99 }
    };

    const KEYS = {
        BEGINNER: 'mines_best_beginner_v1',
        AMATEUR: 'mines_best_amateur_v1',
        EXPERT: 'mines_best_expert_v1'
    };

    window.resetMinesweeperProgress = function(callback) {
        console.log('[Minesweeper] Resetting progress...');

        const keysToRemove = Object.values(KEYS);

        // 1. Очистка LocalStorage
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
        });

        // 2. Очистка CloudStorage
        if (cloudStorage) {
            cloudStorage.removeItems(keysToRemove, (err) => {
                if (err) console.error('Cloud clear error:', err);
                else console.log('Cloud data cleared');

                if (callback) callback();
            });
        } else {
            if (callback) callback();
        }

        // Обновляем UI, если мы находимся на экране меню
        setTimeout(() => {
            updateMenuScores();
        }, 100);
    };

    const StorageManager = {
        getKey(mode) {
            if (mode === 'beginner') return KEYS.BEGINNER;
            if (mode === 'amateur') return KEYS.AMATEUR;
            if (mode === 'expert') return KEYS.EXPERT;
            return null;
        },

        getLocalBest(mode) {
            const key = this.getKey(mode);
            if (!key) return null;
            const val = parseInt(localStorage.getItem(key));
            return isNaN(val) ? null : val;
        },

        saveScore(mode, timeMs) {
            const key = this.getKey(mode);
            if (!key) return;

            log(`Attempt save ${mode}: ${timeMs}`);

            let localBest = this.getLocalBest(mode);
            if (localBest === null || timeMs < localBest) {
                localStorage.setItem(key, timeMs);
                log(`Local saved new best: ${timeMs}`);
                localBest = timeMs;
                updateMenuScores();
            }

            if (cloudStorage) {
                cloudStorage.getItem(key, (err, val) => {
                    if (err) return;

                    const cloudBest = val ? parseInt(val) : null;
                    if (cloudBest === null || timeMs < cloudBest) {
                        cloudStorage.setItem(key, timeMs.toString(), (err) => {
                            if (!err) log(`Cloud saved new best: ${timeMs}`);
                        });
                    }
                });
            }
        },

        syncScores(callback) {
            const modes = ['beginner', 'amateur', 'expert'];
            let processed = 0;

            const checkDone = () => {
                processed++;
                if (processed === modes.length && callback) {
                    callback();
                }
            };

            modes.forEach(mode => {
                const key = this.getKey(mode);
                let localVal = this.getLocalBest(mode);

                if (cloudStorage) {
                    cloudStorage.getItem(key, (err, cloudStr) => {
                        if (!err && cloudStr) {
                            let cloudVal = parseInt(cloudStr);
                            log(`Sync ${mode}: Local=${localVal}, Cloud=${cloudVal}`);

                            if (!isNaN(cloudVal)) {
                                if (localVal === null) {
                                    localStorage.setItem(key, cloudVal);
                                } else if (cloudVal < localVal) {
                                    localStorage.setItem(key, cloudVal);
                                } else if (localVal < cloudVal) {
                                    cloudStorage.setItem(key, localVal.toString());
                                }
                            }
                        } else {
                            if (localVal !== null) {
                                cloudStorage.setItem(key, localVal.toString());
                            }
                        }
                        checkDone();
                    });
                } else {
                    checkDone();
                }
            });
        }
    };

    const UI = {
        menu: document.getElementById('menu-screen'),
        game: document.getElementById('game-screen'),
        grid: document.getElementById('grid'),
        overlay: document.getElementById('result-overlay'),
        minesCount: document.getElementById('mines-count'),
        timer: document.getElementById('timer'),
        restartBtn: document.getElementById('restart-btn'),
        backBtn: document.getElementById('back-to-menu-btn'),
        resultTitle: document.getElementById('result-title'),
        resultTime: document.getElementById('result-time'),
        resultEmoji: document.getElementById('result-emoji'),
        overlayRestart: document.getElementById('overlay-restart-btn'),
        overlayMenu: document.getElementById('overlay-menu-btn'),
        scrollWrapper: document.getElementById('scroll-wrapper'),
        inputs: {
            c: document.getElementById('custom-cols'),
            r: document.getElementById('custom-rows'),
            m: document.getElementById('custom-mines')
        },
        // Элементы помощи
        helpBtn: document.getElementById('help-btn'),
        helpOverlay: document.getElementById('help-overlay'),
        helpClose: document.getElementById('help-close-btn')
    };

    let state = {
        config: {},
        grid: [],
        mode: null,
        started: false,
        over: false,
        won: false,
        startTime: 0,
        timerInt: null,
        flags: 0,
        longPressTimer: null,
        touchStartPos: null,
        keysPressed: {}
    };

    function init() {
        updateMenuScores();
        StorageManager.syncScores(() => {
            updateMenuScores();
        });

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                haptic('light');
                startGame(btn.dataset.mode, PRESETS[btn.dataset.mode]);
            });
        });

        setupCustomInputs();

        document.getElementById('start-custom-btn').addEventListener('click', () => {
            handleCustomStart();
        });

        UI.restartBtn.onclick = () => { haptic('medium'); restartGame(); };
        UI.overlayRestart.onclick = () => { haptic('medium'); restartGame(); };
        UI.backBtn.onclick = () => { haptic('light'); showMenu(); };
        UI.overlayMenu.onclick = () => { haptic('light'); showMenu(); };

        // === ЛОГИКА ПОМОЩИ ===
        UI.helpBtn.onclick = () => {
            UI.helpOverlay.classList.remove('hidden');
            haptic('light');
        };
        UI.helpClose.onclick = () => {
            UI.helpOverlay.classList.add('hidden');
            haptic('light');
        };

        setupKeyboardScroll();
    }

    // === CUSTOM GAME LOGIC ===
    function setupCustomInputs() {
        const { c, r } = UI.inputs;
        const enforceMax = (e) => { if (e.target.value > 30) e.target.value = 30; };
        const enforceMin = (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 2) e.target.value = 2;
        };
        [c, r].forEach(input => {
            input.addEventListener('input', enforceMax);
            input.addEventListener('change', enforceMin);
            input.addEventListener('blur', enforceMin);
        });
    }

    function handleCustomStart() {
        let cols = parseInt(UI.inputs.c.value);
        let rows = parseInt(UI.inputs.r.value);
        let mines = parseInt(UI.inputs.m.value);

        if (cols < 2 || cols > 30 || rows < 2 || rows > 30) {
            tg.showAlert("Размер поля должен быть от 2 до 30!");
            return;
        }
        const maxMines = (rows * cols) - 1;
        if (mines < 1 || mines > maxMines) {
            tg.showAlert(`Количество мин должно быть от 1 до ${maxMines}`);
            return;
        }

        haptic('light');
        startGame('custom', { cols, rows, mines });
    }

    // === ЛОГИКА ИГРЫ ===
    function startGame(mode, config) {
        state.mode = mode;
        state.config = config;
        UI.menu.classList.add('hidden');
        UI.game.classList.remove('hidden');
        UI.overlay.classList.add('hidden');
        UI.helpOverlay.classList.add('hidden'); // На всякий случай скрываем помощь
        resetGame();
    }

    function resetGame() {
        stopTimer();
        state.started = false;
        state.over = false;
        state.won = false;
        state.flags = 0;
        UI.timer.innerText = '00:00.00';
        UI.restartBtn.innerText = '🙂';

        generateBoard();
        updateHeader();
    }

    function restartGame() {
        UI.overlay.classList.add('hidden');
        resetGame();
    }

    function showMenu() {
        stopTimer();
        UI.game.classList.add('hidden');
        UI.overlay.classList.add('hidden');
        UI.menu.classList.remove('hidden');
        updateMenuScores();
    }

    function generateBoard() {
        const { rows, cols } = state.config;
        UI.grid.innerHTML = '';
        UI.grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;

        state.grid = [];
        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) {
                let cell = { r, c, isMine: false, isOpen: false, isFlagged: false, val: 0 };
                row.push(cell);

                const el = document.createElement('div');
                el.className = 'cell';
                el.id = `c-${r}-${c}`;

                el.addEventListener('mousedown', (e) => handleMouse(e, cell));
                el.addEventListener('contextmenu', (e) => { e.preventDefault(); });

                el.addEventListener('touchstart', (e) => handleTouchStart(e, cell, el), {passive: false});
                el.addEventListener('touchmove', (e) => handleTouchMove(e, el), {passive: false});
                el.addEventListener('touchend', (e) => handleTouchEnd(e, cell, el), {passive: false});

                UI.grid.appendChild(el);
            }
            state.grid.push(row);
        }

        placeMines(state.grid);
        calcNumbers(state.grid);
    }

    function placeMines(grid) {
        const { rows, cols, mines } = state.config;
        let placed = 0;
        while(placed < mines) {
            let r = Math.floor(Math.random() * rows);
            let c = Math.floor(Math.random() * cols);
            if (!grid[r][c].isMine) {
                grid[r][c].isMine = true;
                placed++;
            }
        }
    }

    function calcNumbers(grid) {
        grid.forEach(row => row.forEach(cell => {
            if (!cell.isMine) {
                cell.val = getNeighbors(grid, cell.r, cell.c).filter(n => n.isMine).length;
            }
        }));
    }

    // === УПРАВЛЕНИЕ ===
    function setupKeyboardScroll() {
        document.addEventListener('keydown', (e) => {
            if (UI.game.classList.contains('hidden')) return;
            if (e.target.tagName === 'INPUT') return;

            const code = e.code;
            const validCodes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];

            if (validCodes.includes(code)) {
                state.keysPressed[code] = true;
                if (!state.isScrollingLoop) {
                    state.isScrollingLoop = true;
                    requestAnimationFrame(scrollLoop);
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            state.keysPressed[e.code] = false;
        });
    }

    function scrollLoop() {
        const speed = 15;
        const wrapper = UI.scrollWrapper;
        if (state.keysPressed['KeyW'] || state.keysPressed['ArrowUp']) wrapper.scrollTop -= speed;
        if (state.keysPressed['KeyS'] || state.keysPressed['ArrowDown']) wrapper.scrollTop += speed;
        if (state.keysPressed['KeyA'] || state.keysPressed['ArrowLeft']) wrapper.scrollLeft -= speed;
        if (state.keysPressed['KeyD'] || state.keysPressed['ArrowRight']) wrapper.scrollLeft += speed;

        const anyPressed = Object.values(state.keysPressed).some(v => v);
        if (anyPressed) requestAnimationFrame(scrollLoop);
        else state.isScrollingLoop = false;
    }

    function handleMouse(e, cell) {
        if (state.over) return;
        if (e.button === 0) handleClick(cell);
        else if (e.button === 2) toggleFlag(cell);
    }

    function handleTouchStart(e, cell, el) {
        if (state.over) return;
        if (cell.isOpen && cell.val === 0) return;

        state.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        el.classList.add('pressing');

        state.longPressTimer = setTimeout(() => {
            state.longPressTimer = null;
            el.classList.remove('pressing');
            toggleFlag(cell);
            haptic('medium');
        }, 350);
    }

    function handleTouchMove(e, el) {
        if (!state.touchStartPos) return;
        const dist = Math.hypot(e.touches[0].clientX - state.touchStartPos.x, e.touches[0].clientY - state.touchStartPos.y);
        if (dist > 10) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
            state.touchStartPos = null;
            el.classList.remove('pressing');
        }
    }

    function handleTouchEnd(e, cell, el) {
        el.classList.remove('pressing');
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
            if (state.touchStartPos) {
                if (e.cancelable) e.preventDefault();
                haptic('light');
                handleClick(cell);
            }
        }
        state.touchStartPos = null;
    }

    function handleClick(cell) {
        if (state.over || state.won || cell.isFlagged) return;
        if (!state.started) { state.started = true; startTimer(); }
        const activeCell = state.grid[cell.r][cell.c];
        if (activeCell.isOpen) { tryChord(activeCell); return; }
        openCell(activeCell);
    }

    function toggleFlag(cell) {
        if (!state.started && !state.over) { state.started = true; startTimer(); }
        if (state.over || cell.isOpen) return;
        const activeCell = state.grid[cell.r][cell.c];
        activeCell.isFlagged = !activeCell.isFlagged;
        state.flags += activeCell.isFlagged ? 1 : -1;
        updateVisual(activeCell);
        updateHeader();
        haptic('selection');
    }

    function tryChord(cell) {
        if (cell.val === 0) return;
        const neighbors = getNeighbors(state.grid, cell.r, cell.c);
        const flags = neighbors.filter(n => n.isFlagged).length;
        if (flags === cell.val) {
            let triggered = false;
            neighbors.forEach(n => {
                if (!n.isOpen && !n.isFlagged) { openCell(n); triggered = true; }
            });
            if(triggered) haptic('medium');
        } else {
            const el = document.getElementById(`c-${cell.r}-${cell.c}`);
            if (el) {
                el.classList.remove('chord-error');
                void el.offsetWidth;
                el.classList.add('chord-error');
                haptic('error');
            }
        }
    }

    function openCell(cell) {
        if (cell.isOpen || cell.isFlagged) return;
        cell.isOpen = true;
        updateVisual(cell);
        if (cell.isMine) { gameOver(false); return; }
        if (cell.val === 0) getNeighbors(state.grid, cell.r, cell.c).forEach(n => openCell(n));
        checkWin();
    }

    function checkWin() {
        const { rows, cols, mines } = state.config;
        let opened = 0;
        state.grid.forEach(r => r.forEach(c => { if(c.isOpen) opened++; }));
        if (opened === (rows * cols - mines)) gameOver(true);
    }

    function gameOver(win) {
        state.over = true;
        state.won = win;
        stopTimer();
        if (win) {
            UI.restartBtn.innerText = '😎';
            UI.resultEmoji.innerText = '😎';
            UI.resultTitle.innerText = 'Победа!';
            haptic('success');
            let timeMs = Date.now() - state.startTime;
            if (state.mode !== 'custom') StorageManager.saveScore(state.mode, timeMs);
        } else {
            UI.restartBtn.innerText = '😵';
            UI.resultEmoji.innerText = '💥';
            UI.resultTitle.innerText = 'Взрыв!';
            haptic('error');
            revealMinesWave();
        }
        UI.resultTime.innerText = UI.timer.innerText;
        setTimeout(() => UI.overlay.classList.remove('hidden'), 1200);
    }

    function revealMinesWave() {
        let targets = [];
        state.grid.forEach(r => r.forEach(c => {
            if (c.isMine && !c.isFlagged) targets.push({c, type: 'mine'});
            else if (!c.isMine && c.isFlagged) targets.push({c, type: 'wrong'});
        }));
        targets.sort((a,b) => (a.c.r + a.c.c) - (b.c.r + b.c.c));
        targets.forEach((item, index) => {
            setTimeout(() => {
                const el = document.getElementById(`c-${item.c.r}-${item.c.c}`);
                if (!el) return;
                if (item.type === 'mine') { el.classList.add('mine', 'revealed-mine'); el.innerText = '💣'; }
                else { el.classList.add('wrong-flag'); }
            }, index * 15);
        });
    }

    function updateVisual(cell) {
        const el = document.getElementById(`c-${cell.r}-${cell.c}`);
        if (!el) return;
        el.className = 'cell';
        el.innerText = '';
        if (cell.isOpen) {
            el.classList.add('open');
            if (cell.isMine) { el.classList.add('mine'); el.innerText = '💣'; }
            else if (cell.val > 0) { el.innerText = cell.val; el.classList.add(`val-${cell.val}`); }
        } else if (cell.isFlagged) { el.classList.add('flagged'); el.innerText = '🚩'; }
    }

    function updateHeader() { UI.minesCount.innerText = Math.max(0, state.config.mines - state.flags); }

    function getNeighbors(grid, r, c) {
        let res = [];
        for(let dr=-1; dr<=1; dr++) {
            for(let dc=-1; dc<=1; dc++) {
                if(dr==0 && dc==0) continue;
                let nr = r+dr, nc = c+dc;
                if(nr>=0 && nr<grid.length && nc>=0 && nc<grid[0].length) res.push(grid[nr][nc]);
            }
        }
        return res;
    }

    function startTimer() {
        state.startTime = Date.now();
        state.timerInt = setInterval(() => { UI.timer.innerText = formatTime(Date.now() - state.startTime); }, 30);
    }
    function stopTimer() { clearInterval(state.timerInt); }

    function updateMenuScores() {
        ['beginner', 'amateur', 'expert'].forEach(mode => {
            const el = document.getElementById(`score-${mode}`);
            const bestTime = StorageManager.getLocalBest(mode);
            el.innerText = formatTime(bestTime);
        });
    }

    init();
});