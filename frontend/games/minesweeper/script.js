document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();
    if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

    function haptic(type) {
        if (!tg.HapticFeedback) return;
        if (type === 'light') tg.HapticFeedback.impactOccurred('light');
        if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
        if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        if (type === 'selection') tg.HapticFeedback.selectionChanged();
    }

    const PRESETS = {
        beginner: { rows: 9, cols: 9, mines: 10 },
        amateur: { rows: 16, cols: 16, mines: 40 },
        expert: { rows: 16, cols: 30, mines: 99 }
    };
    const KEYS = {
        BEGINNER: 'minesweeper_best_beginner',
        AMATEUR: 'minesweeper_best_amateur',
        EXPERT: 'minesweeper_best_expert'
    };

    const StorageManager = {
        getKey(mode) {
            if (mode === 'beginner') return KEYS.BEGINNER;
            if (mode === 'amateur') return KEYS.AMATEUR;
            if (mode === 'expert') return KEYS.EXPERT;
            return null;
        },
        saveScore(mode, timeMs) {
            const key = this.getKey(mode);
            if (!key) return;
            let currentLocal = parseInt(localStorage.getItem(key)) || Infinity;
            if (timeMs < currentLocal) {
                localStorage.setItem(key, timeMs);
            }
            if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                tg.CloudStorage.getItem(key, (err, val) => {
                    let cloudVal = val ? parseInt(val) : Infinity;
                    if (timeMs < cloudVal) {
                        tg.CloudStorage.setItem(key, timeMs.toString());
                    }
                });
            }
        },
        syncScores(callback) {
            const modes = ['beginner', 'amateur', 'expert'];
            let processed = 0;
            modes.forEach(mode => {
                const key = this.getKey(mode);
                let localVal = parseInt(localStorage.getItem(key)) || null;
                if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                    tg.CloudStorage.getItem(key, (err, cloudStr) => {
                        let cloudVal = cloudStr ? parseInt(cloudStr) : null;
                        if (cloudVal !== null && (localVal === null || cloudVal < localVal)) {
                            localStorage.setItem(key, cloudVal);
                        } else if (localVal !== null && (cloudVal === null || localVal < cloudVal)) {
                            tg.CloudStorage.setItem(key, localVal.toString());
                        }
                        processed++;
                        if (processed === modes.length && callback) callback();
                    });
                } else {
                    processed++;
                    if (processed === modes.length && callback) callback();
                }
            });
        },
        getBestTime(mode) {
            const key = this.getKey(mode);
            if (!key) return null;
            return parseInt(localStorage.getItem(key)) || null;
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
        }
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
        isScrolling: false // Флаг для отличия клика от драга
    };

    function init() {
        StorageManager.syncScores(() => { updateMenuScores(); });

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                haptic('light');
                startGame(btn.dataset.mode, PRESETS[btn.dataset.mode]);
            });
        });

        document.getElementById('start-custom-btn').addEventListener('click', () => {
            // Валидация
            const cols = clamp(UI.inputs.c.value, 10, 99);
            const rows = clamp(UI.inputs.r.value, 10, 99);
            const mines = clamp(UI.inputs.m.value, 1, 99);

            // Проверка: Мины < Ячейки
            if (mines >= rows * cols) {
                tg.showAlert(`Слишком много мин! Максимум для поля ${cols}x${rows}: ${rows*cols - 1}`);
                return;
            }

            haptic('light');
            startGame('custom', { cols, rows, mines });
        });

        UI.restartBtn.onclick = () => { haptic('medium'); restartGame(); };
        UI.overlayRestart.onclick = () => { haptic('medium'); restartGame(); };
        UI.backBtn.onclick = () => { haptic('light'); showMenu(); };
        UI.overlayMenu.onclick = () => { haptic('light'); showMenu(); };

        setupDesktopDragScroll();
    }

    function clamp(val, min, max) {
        let v = parseInt(val) || min;
        return Math.min(Math.max(v, min), max);
    }

    // === ЛОГИКА ИГРЫ ===

    function startGame(mode, config) {
        state.mode = mode;
        state.config = config;
        UI.menu.classList.add('hidden');
        UI.game.classList.remove('hidden');
        UI.overlay.classList.add('hidden');
        resetGame();
    }

    function resetGame() {
        stopTimer();
        state.started = false;
        state.over = false;
        state.won = false;
        state.flags = 0;
        UI.timer.innerText = '00:00';
        UI.restartBtn.innerText = '🙂';

        // Генерируем поле СРАЗУ (случайно, без сейв-зоны)
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

        // 1. Создаем структуру
        state.grid = [];
        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) {
                let cell = { r, c, isMine: false, isOpen: false, isFlagged: false, val: 0 };
                row.push(cell);

                const el = document.createElement('div');
                el.className = 'cell';
                el.id = `c-${r}-${c}`;

                // События
                el.addEventListener('mousedown', (e) => handleMouse(e, cell));
                el.addEventListener('contextmenu', (e) => { e.preventDefault(); });

                // Touch
                el.addEventListener('touchstart', (e) => handleTouchStart(e, cell, el), {passive: false});
                el.addEventListener('touchmove', (e) => handleTouchMove(e, el), {passive: false}); // passive: false не обязателен, если не делаем preventDefault
                el.addEventListener('touchend', (e) => handleTouchEnd(e, cell, el), {passive: false});

                UI.grid.appendChild(el);
            }
            state.grid.push(row);
        }

        // 2. Расставляем мины (Абсолютный рандом)
        placeMines(state.grid);

        // 3. Считаем цифры
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

    // === УПРАВЛЕНИЕ DESKTOP DRAG SCROLL ===
    function setupDesktopDragScroll() {
        const wrapper = UI.scrollWrapper;
        let isDown = false;
        let startX, startY;
        let scrollLeft, scrollTop;

        wrapper.addEventListener('mousedown', (e) => {
            // Если клик правой кнопкой - игнорируем драг
            if (e.button !== 0) return;
            isDown = true;
            state.isScrolling = false; // Сброс
            wrapper.classList.add('grabbing');
            startX = e.pageX - wrapper.offsetLeft;
            startY = e.pageY - wrapper.offsetTop;
            scrollLeft = wrapper.scrollLeft;
            scrollTop = wrapper.scrollTop;
        });

        wrapper.addEventListener('mouseleave', () => {
            isDown = false;
            wrapper.classList.remove('grabbing');
        });

        wrapper.addEventListener('mouseup', () => {
            isDown = false;
            wrapper.classList.remove('grabbing');
            // isScrolling остается true, если мы двигали, чтобы click handler понял это
            setTimeout(() => { state.isScrolling = false; }, 50);
        });

        wrapper.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - wrapper.offsetLeft;
            const y = e.pageY - wrapper.offsetTop;
            const walkX = (x - startX);
            const walkY = (y - startY);

            // Если сдвинули хоть немного - считаем это скроллом, а не кликом
            if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) {
                state.isScrolling = true;
                wrapper.scrollLeft = scrollLeft - walkX;
                wrapper.scrollTop = scrollTop - walkY;
            }
        });
    }

    // === ОБРАБОТКА ВВОДА ЯЧЕЕК ===

    function handleMouse(e, cell) {
        // Если мы скроллили (drag), то клик не должен сработать
        if (state.isScrolling) return;
        if (state.over) return;

        if (e.button === 0) handleClick(cell);
        else if (e.button === 2) toggleFlag(cell);
    }

    // --- Touch Logic ---
    function handleTouchStart(e, cell, el) {
        if (state.over) return;
        // Не preventDefault(), чтобы работал нативный скролл!

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
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dist = Math.hypot(x - state.touchStartPos.x, y - state.touchStartPos.y);

        // Если сдвинули палец > 10px, считаем это скроллом -> отменяем игровые действия
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
            // Если таймер не сработал (значит палец подняли быстро)
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;

            // Если это не был свайп (touchStartPos не null)
            if (state.touchStartPos) {
                // ВАЖНО: Предотвращаем дефолтный клик браузера, т.к. мы обработали тап
                if (e.cancelable) e.preventDefault();
                haptic('light');
                handleClick(cell);
            }
        }
        state.touchStartPos = null;
    }

    // === ДЕЙСТВИЯ ===
    function handleClick(cell) {
        if (state.over || state.won || cell.isFlagged) return;

        if (!state.started) {
            state.started = true;
            startTimer();
        }

        const activeCell = state.grid[cell.r][cell.c];
        if (activeCell.isOpen) {
            tryChord(activeCell);
            return;
        }
        openCell(activeCell);
    }

    function toggleFlag(cell) {
        if (!state.started && !state.over) {
            state.started = true; startTimer();
        }
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
                if (!n.isOpen && !n.isFlagged) {
                    openCell(n);
                    triggered = true;
                }
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

        if (cell.isMine) {
            gameOver(false);
            return;
        }

        if (cell.val === 0) {
            getNeighbors(state.grid, cell.r, cell.c).forEach(n => openCell(n));
        }

        checkWin();
    }

    function checkWin() {
        const { rows, cols, mines } = state.config;
        let opened = 0;
        state.grid.forEach(r => r.forEach(c => { if(c.isOpen) opened++; }));
        if (opened === (rows * cols - mines)) {
            gameOver(true);
        }
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
            StorageManager.saveScore(state.mode, timeMs);
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
                if (item.type === 'mine') {
                    el.classList.add('mine', 'revealed-mine');
                    el.innerText = '💣';
                } else {
                    el.classList.add('wrong-flag');
                }
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
            if (cell.isMine) {
                el.classList.add('mine');
                el.innerText = '💣';
            } else if (cell.val > 0) {
                el.innerText = cell.val;
                el.classList.add(`val-${cell.val}`);
            }
        } else if (cell.isFlagged) {
            el.classList.add('flagged');
            el.innerText = '🚩';
        }
    }

    function updateHeader() {
        UI.minesCount.innerText = Math.max(0, state.config.mines - state.flags);
    }

    function getNeighbors(grid, r, c) {
        let res = [];
        for(let dr=-1; dr<=1; dr++) {
            for(let dc=-1; dc<=1; dc++) {
                if(dr==0 && dc==0) continue;
                let nr = r+dr, nc = c+dc;
                if(nr>=0 && nr<grid.length && nc>=0 && nc<grid[0].length) {
                    res.push(grid[nr][nc]);
                }
            }
        }
        return res;
    }

    function startTimer() {
        state.startTime = Date.now();
        state.timerInt = setInterval(() => {
            let delta = Math.floor((Date.now() - state.startTime)/1000);
            let m = Math.floor(delta/60).toString().padStart(2,'0');
            let s = (delta%60).toString().padStart(2,'0');
            UI.timer.innerText = `${m}:${s}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(state.timerInt);
    }

    function updateMenuScores() {
        ['beginner', 'amateur', 'expert'].forEach(mode => {
            const el = document.getElementById(`score-${mode}`);
            const bestTime = StorageManager.getBestTime(mode);
            if (bestTime) {
                let d = Math.floor(bestTime/1000);
                el.innerText = `${Math.floor(d/60).toString().padStart(2,'0')}:${(d%60).toString().padStart(2,'0')}`;
            } else {
                el.innerText = '--:--';
            }
        });
    }

    init();
});