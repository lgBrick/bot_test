document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    // Расширяем на весь экран
    if (tg.expand) tg.expand();
    // Блокируем вертикальный свайп закрытия (если поддерживается)
    if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

    // Haptic wrapper
    function haptic(type) {
        if (!tg.HapticFeedback) return;
        if (type === 'light') tg.HapticFeedback.impactOccurred('light');
        if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
        if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        if (type === 'selection') tg.HapticFeedback.selectionChanged();
    }

    // === КОНФИГУРАЦИЯ ===
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

    // === МЕНЕДЖЕР СОХРАНЕНИЙ (CLOUD + LOCAL) ===
    const StorageManager = {
        getKey(mode) {
            if (mode === 'beginner') return KEYS.BEGINNER;
            if (mode === 'amateur') return KEYS.AMATEUR;
            if (mode === 'expert') return KEYS.EXPERT;
            return null;
        },

        saveScore(mode, timeMs) {
            const key = this.getKey(mode);
            if (!key) return; // Кастом не сохраняем

            // 1. Сохраняем локально мгновенно
            let currentLocal = parseInt(localStorage.getItem(key)) || Infinity;
            if (timeMs < currentLocal) {
                localStorage.setItem(key, timeMs);
                console.log(`[Local] New Record: ${timeMs}`);
            }

            // 2. Пробуем сохранить в облако
            if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                tg.CloudStorage.getItem(key, (err, val) => {
                    let cloudVal = val ? parseInt(val) : Infinity;
                    if (timeMs < cloudVal) {
                        tg.CloudStorage.setItem(key, timeMs.toString(), (e) => {
                            if(!e) console.log(`[Cloud] Saved: ${timeMs}`);
                        });
                    }
                });
            }
        },

        syncScores(callback) {
            // Проходимся по всем режимам
            const modes = ['beginner', 'amateur', 'expert'];
            let processed = 0;

            modes.forEach(mode => {
                const key = this.getKey(mode);
                // Берем локальное
                let localVal = parseInt(localStorage.getItem(key)) || null;

                if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                    tg.CloudStorage.getItem(key, (err, cloudStr) => {
                        let cloudVal = cloudStr ? parseInt(cloudStr) : null;

                        // Логика слияния: лучшее время (меньшее) побеждает
                        if (cloudVal !== null && (localVal === null || cloudVal < localVal)) {
                            localStorage.setItem(key, cloudVal); // Облако круче -> обновляем локалку
                        } else if (localVal !== null && (cloudVal === null || localVal < cloudVal)) {
                            tg.CloudStorage.setItem(key, localVal.toString()); // Локалка круче -> пушим в облако
                        }

                        processed++;
                        if (processed === modes.length && callback) callback();
                    });
                } else {
                    // Если нет облака, просто считаем что готово
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

    // === ЭЛЕМЕНТЫ UI ===
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
        inputs: {
            c: document.getElementById('custom-cols'),
            r: document.getElementById('custom-rows'),
            m: document.getElementById('custom-mines')
        }
    };

    // === СОСТОЯНИЕ ИГРЫ ===
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
        touchStartPos: null
    };

    // === ИНИЦИАЛИЗАЦИЯ ===
    function init() {
        // Синхронизируем рекорды при запуске
        StorageManager.syncScores(() => {
            updateMenuScores();
        });

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                haptic('light');
                startGame(btn.dataset.mode, PRESETS[btn.dataset.mode]);
            });
        });

        document.getElementById('start-custom-btn').addEventListener('click', () => {
            const cols = clamp(UI.inputs.c.value, 5, 30);
            const rows = clamp(UI.inputs.r.value, 5, 30);
            const maxMines = Math.floor(cols * rows * 0.85);
            const mines = clamp(UI.inputs.m.value, 1, maxMines);
            haptic('light');
            startGame('custom', { cols, rows, mines });
        });

        UI.restartBtn.onclick = () => { haptic('medium'); restartGame(); };
        UI.overlayRestart.onclick = () => { haptic('medium'); restartGame(); };
        UI.backBtn.onclick = () => { haptic('light'); showMenu(); };
        UI.overlayMenu.onclick = () => { haptic('light'); showMenu(); };
    }

    function clamp(val, min, max) {
        return Math.min(Math.max(parseInt(val) || min, min), max);
    }

    // === УПРАВЛЕНИЕ ИГРОЙ ===
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

        createEmptyGrid(); // Рисуем сетку, но логику не генерируем до клика
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

    // === ГЕНЕРАЦИЯ ПОЛЯ (NO GUESSING) ===
    function createEmptyGrid() {
        const { rows, cols } = state.config;
        UI.grid.innerHTML = '';
        UI.grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;

        state.grid = [];
        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) {
                // Объект ячейки
                let cell = { r, c, isMine: false, isOpen: false, isFlagged: false, val: 0 };
                row.push(cell);

                // DOM элемент
                const el = document.createElement('div');
                el.className = 'cell';
                el.id = `c-${r}-${c}`;

                // --- НОВАЯ СИСТЕМА СОБЫТИЙ ДЛЯ МОБИЛОК ---
                // Мышь
                el.addEventListener('mousedown', (e) => handleMouse(e, cell));
                el.addEventListener('contextmenu', (e) => { e.preventDefault(); }); // Блокируем меню

                // Тач (с поддержкой long press и dead zone)
                el.addEventListener('touchstart', (e) => handleTouchStart(e, cell, el), {passive: false});
                el.addEventListener('touchmove', (e) => handleTouchMove(e, el), {passive: false});
                el.addEventListener('touchend', (e) => handleTouchEnd(e, cell, el), {passive: false});

                UI.grid.appendChild(el);
            }
            state.grid.push(row);
        }
    }

    function generateBoard(startR, startC) {
        // Пытаемся сгенерировать решаемое поле
        let attempts = 0;
        while (attempts < 50) {
            let grid = createBaseGridStructure();
            placeMines(grid, startR, startC);
            calcNumbers(grid);

            // Критерий 1: Первая клетка должна быть 0 (открытие области)
            if (grid[startR][startC].val !== 0) {
                attempts++; continue;
            }

            // Критерий 2: Поле должно решаться логически
            if (isSolvable(grid, startR, startC)) {
                return grid;
            }
            attempts++;
        }

        // Фолбэк (если не вышло за 50 попыток, даем просто поле с 0 на старте)
        let fallback = createBaseGridStructure();
        placeMines(fallback, startR, startC);
        calcNumbers(fallback);
        // Зачищаем старт если там не 0 (грубая сила для фолбэка)
        if (fallback[startR][startC].val !== 0) {
           // В редком случае просто вернем что есть, игрок поймет
        }
        return fallback;
    }

    function createBaseGridStructure() {
        const { rows, cols } = state.config;
        return Array.from({length: rows}, (_, r) =>
            Array.from({length: cols}, (_, c) => ({
                r, c, isMine: false, isOpen: false, isFlagged: false, val: 0
            }))
        );
    }

    function placeMines(grid, safeR, safeC) {
        const { rows, cols, mines } = state.config;
        let placed = 0;
        while(placed < mines) {
            let r = Math.floor(Math.random() * rows);
            let c = Math.floor(Math.random() * cols);

            // Защитная зона 3x3 вокруг старта для гарантированного нуля или 5x5 для простоты
            if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;

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

    // Простой решатель
    function isSolvable(grid, startR, startC) {
        let simGrid = grid.map(row => row.map(c => ({...c})));
        let changed = true;
        openSim(simGrid, startR, startC);

        while(changed) {
            changed = false;
            for(let r=0; r<simGrid.length; r++) {
                for(let c=0; c<simGrid[0].length; c++) {
                    let cell = simGrid[r][c];
                    if(cell.isOpen && cell.val > 0) {
                        let neighbors = getNeighbors(simGrid, r, c);
                        let hidden = neighbors.filter(n => !n.isOpen);
                        let flagged = neighbors.filter(n => n.isFlagged);
                        // Флаги
                        if(hidden.length > 0 && hidden.length === cell.val - flagged.length) {
                            hidden.forEach(n => { if(!n.isFlagged) { n.isFlagged = true; changed = true; } });
                        }
                        // Открытие
                        if(flagged.length === cell.val && hidden.length > flagged.length) {
                            hidden.forEach(n => { if(!n.isFlagged && !n.isOpen) { openSim(simGrid, n.r, n.c); changed = true; } });
                        }
                    }
                }
            }
        }
        return !simGrid.some(row => row.some(c => !c.isMine && !c.isOpen));
    }

    function openSim(grid, r, c) {
        if(grid[r][c].isOpen || grid[r][c].isFlagged) return;
        grid[r][c].isOpen = true;
        if(grid[r][c].val === 0) {
            getNeighbors(grid, r, c).forEach(n => openSim(grid, n.r, n.c));
        }
    }

    // === ОБРАБОТКА ВВОДА (TOUCH & MOUSE) ===

    // Мышь (десктоп)
    function handleMouse(e, cell) {
        if (state.over) return;
        if (e.button === 0) handleClick(cell); // ЛКМ
        else if (e.button === 2) toggleFlag(cell); // ПКМ
    }

    // Тач (мобильные)
    function handleTouchStart(e, cell, el) {
        if (state.over) return;
        if (cell.isOpen && cell.val === 0) return; // Пустые открытые не трогаем

        // Запоминаем позицию для Dead Zone
        state.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };

        // Визуальный эффект нажатия
        el.classList.add('pressing');

        // Таймер для флага (Long Press)
        state.longPressTimer = setTimeout(() => {
            state.longPressTimer = null;
            el.classList.remove('pressing');
            toggleFlag(cell);
            haptic('medium'); // Вибрация при установке флага
        }, 350); // 350мс удержание
    }

    function handleTouchMove(e, el) {
        if (!state.touchStartPos) return;
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;

        // Расстояние сдвига пальца
        const dist = Math.hypot(x - state.touchStartPos.x, y - state.touchStartPos.y);

        // Если сдвинули больше чем на 10px -> отменяем Long Press
        if (dist > 10) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
            state.touchStartPos = null;
            el.classList.remove('pressing');
        }
    }

    function handleTouchEnd(e, cell, el) {
        el.classList.remove('pressing');

        // Если таймер еще жив -> значит это был короткий тап
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
            // Если тач не был отменен мувом
            if (state.touchStartPos) {
                haptic('light');
                handleClick(cell);
            }
        }
        state.touchStartPos = null;
        e.preventDefault(); // Чтоб не было клика мыши следом
    }


    // === ЛОГИКА ДЕЙСТВИЙ ===

    function handleClick(cell) {
        if (state.over || state.won || cell.isFlagged) return;

        // Генерация при первом клике
        if (!state.started) {
            state.started = true;
            startTimer();
            state.grid = generateBoard(cell.r, cell.c);
        }

        const activeCell = state.grid[cell.r][cell.c];

        // Аккорд
        if (activeCell.isOpen) {
            tryChord(activeCell);
            return;
        }

        openCell(activeCell);
    }

    function toggleFlag(cell) {
        if (!state.started || state.over || cell.isOpen) return;
        const activeCell = state.grid[cell.r][cell.c]; // Актуальная ячейка из state

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
            // Флагов хватает -> открываем
            let triggered = false;
            neighbors.forEach(n => {
                if (!n.isOpen && !n.isFlagged) {
                    openCell(n);
                    triggered = true;
                }
            });
            if(triggered) haptic('medium');
        } else {
            // Флагов мало или много -> ошибка (визуал)
            const el = document.getElementById(`c-${cell.r}-${cell.c}`);
            if (el) {
                el.classList.remove('chord-error');
                void el.offsetWidth; // Reflow
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
            // Рекурсивное открытие пустых
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
            // Сохраняем время
            let timeMs = Date.now() - state.startTime;
            StorageManager.saveScore(state.mode, timeMs);
        } else {
            UI.restartBtn.innerText = '😵';
            UI.resultEmoji.innerText = '💥';
            UI.resultTitle.innerText = 'Взрыв!';
            haptic('error');

            // Анимация показа мин
            revealMinesWave();
        }

        UI.resultTime.innerText = UI.timer.innerText;
        setTimeout(() => UI.overlay.classList.remove('hidden'), 1200);
    }

    function revealMinesWave() {
        // Собираем все мины и неправильные флаги
        let targets = [];
        state.grid.forEach(r => r.forEach(c => {
            if (c.isMine && !c.isFlagged) targets.push({c, type: 'mine'});
            else if (!c.isMine && c.isFlagged) targets.push({c, type: 'wrong'});
        }));

        // Перемешиваем для красоты или идем по порядку. По порядку "волной" лучше.
        // Сортируем по расстоянию от левого верха для волны
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
            }, index * 15); // Задержка для волны
        });
    }

    // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
    function updateVisual(cell) {
        const el = document.getElementById(`c-${cell.r}-${cell.c}`);
        if (!el) return;

        // Сброс классов
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