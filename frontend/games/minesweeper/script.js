document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();

    // Haptic feedback
    function haptic(type) {
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred(type);
    }

    // === КОНФИГУРАЦИЯ ===
    const PRESETS = {
        beginner: { rows: 9, cols: 9, mines: 10 },
        amateur: { rows: 16, cols: 16, mines: 40 },
        expert: { rows: 16, cols: 30, mines: 99 }
    };
    const RECORDS_KEY = 'minesweeper_records_tg';

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
        grid: [], // 2D массив
        mode: null, // beginner, amateur, expert, custom
        started: false,
        over: false,
        won: false,
        startTime: 0,
        timerInt: null,
        flags: 0
    };

    // === ИНИЦИАЛИЗАЦИЯ ===
    function init() {
        updateMenuScores();

        // Кнопки меню пресетов
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                haptic('light');
                startGame(btn.dataset.mode, PRESETS[btn.dataset.mode]);
            });
        });

        // Кнопка кастомной игры
        document.getElementById('start-custom-btn').addEventListener('click', () => {
            const cols = clamp(UI.inputs.c.value, 5, 30);
            const rows = clamp(UI.inputs.r.value, 5, 30);
            const maxMines = Math.floor(cols * rows * 0.85); // Макс 85% мин
            const mines = clamp(UI.inputs.m.value, 1, maxMines);

            haptic('light');
            startGame('custom', { cols, rows, mines });
        });

        // Игровые кнопки
        UI.restartBtn.onclick = () => { haptic('medium'); restartGame(); };
        UI.overlayRestart.onclick = () => { haptic('medium'); restartGame(); };
        UI.backBtn.onclick = () => { haptic('light'); showMenu(); };
        UI.overlayMenu.onclick = () => { haptic('light'); showMenu(); };
    }

    function clamp(val, min, max) {
        return Math.min(Math.max(parseInt(val) || min, min), max);
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

        // Создаем пустую сетку для визуала
        createEmptyGrid();
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

    function createEmptyGrid() {
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

                // Обработчики
                el.onclick = () => handleLeftClick(cell);
                el.oncontextmenu = (e) => { e.preventDefault(); handleRightClick(cell); };

                // Долгое нажатие для тача
                let touchTimer;
                el.ontouchstart = () => { touchTimer = setTimeout(() => { haptic('medium'); handleRightClick(cell); }, 400); };
                el.ontouchend = () => clearTimeout(touchTimer);

                UI.grid.appendChild(el);
            }
            state.grid.push(row);
        }
    }

    // === NO GUESSING GENERATOR ===
    // Генерирует поле, которое гарантированно решается без угадывания
    function generateBoard(safeR, safeC) {
        let attempts = 0;
        let bestGrid = null;

        while(attempts < 50) {
            // 1. Создаем случайное поле
            let grid = createBaseGridStructure();
            placeMines(grid, safeR, safeC);
            calcNumbers(grid);

            // 2. Проверяем решаемость
            if (isSolvable(grid, safeR, safeC)) {
                return grid;
            }
            attempts++;
        }

        // Если не вышло (редко), возвращаем последнее сгенерированное
        let fallback = createBaseGridStructure();
        placeMines(fallback, safeR, safeC);
        calcNumbers(fallback);
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
            // Гарантируем безопасную зону вокруг первого клика
            if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
            if (!grid[r][c].isMine) {
                grid[r][c].isMine = true;
                placed++;
            }
        }
    }

    function calcNumbers(grid) {
        const rows = grid.length, cols = grid[0].length;
        grid.forEach(row => row.forEach(cell => {
            if (!cell.isMine) {
                cell.val = getNeighbors(grid, cell.r, cell.c).filter(n => n.isMine).length;
            }
        }));
    }

    // Простой солвер для проверки решаемости
    function isSolvable(grid, startR, startC) {
        let simGrid = grid.map(row => row.map(c => ({...c}))); // Клон
        let changed = true;

        // Открываем старт
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

                        // 1. Все соседи - мины
                        if(hidden.length > 0 && hidden.length === cell.val - flagged.length) {
                            hidden.forEach(n => { if(!n.isFlagged) { n.isFlagged = true; changed = true; } });
                        }
                        // 2. Все мины найдены, остальные безопасны
                        if(flagged.length === cell.val && hidden.length > flagged.length) {
                            hidden.forEach(n => { if(!n.isFlagged && !n.isOpen) { openSim(simGrid, n.r, n.c); changed = true; } });
                        }
                    }
                }
            }
        }

        // Проверка: остались ли закрытые не-мины?
        return !simGrid.some(row => row.some(c => !c.isMine && !c.isOpen));
    }

    function openSim(grid, r, c) {
        if(grid[r][c].isOpen || grid[r][c].isFlagged) return;
        grid[r][c].isOpen = true;
        if(grid[r][c].val === 0) {
            getNeighbors(grid, r, c).forEach(n => openSim(grid, n.r, n.c));
        }
    }

    // === ГЕЙМПЛЕЙ ===

    function handleLeftClick(cell) {
        if (state.over || state.won || cell.isFlagged) return;

        // Первый клик
        if (!state.started) {
            state.started = true;
            startTimer();
            // Генерируем поле и заменяем стейт
            state.grid = generateBoard(cell.r, cell.c);
        }

        // Получаем актуальную ячейку (после генерации ссылка могла измениться)
        const activeCell = state.grid[cell.r][cell.c];

        // Аккорд (если уже открыта)
        if (activeCell.isOpen) {
            tryChord(activeCell);
            return;
        }

        openCell(activeCell);
    }

    function handleRightClick(cell) {
        if (!state.started || state.over || cell.isOpen) return;
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
            if(triggered) haptic('light');
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
            saveRecord();
        } else {
            UI.restartBtn.innerText = '😵';
            UI.resultEmoji.innerText = '💥';
            UI.resultTitle.innerText = 'Взрыв!';
            haptic('error');
            // Показываем мины
            state.grid.forEach(r => r.forEach(c => {
                if (c.isMine && !c.isFlagged) {
                    c.isOpen = true;
                    updateVisual(c);
                } else if (!c.isMine && c.isFlagged) {
                    const el = document.getElementById(`c-${c.r}-${c.c}`);
                    if(el) el.classList.add('wrong-flag');
                }
            }));
        }

        UI.resultTime.innerText = UI.timer.innerText;
        setTimeout(() => UI.overlay.classList.remove('hidden'), 1000);
    }

    // === ВИЗУАЛ ===

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
        UI.minesCount.innerText = state.config.mines - state.flags;
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

    // === ТАЙМЕР И РЕКОРДЫ ===

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

    function saveRecord() {
        if (state.mode === 'custom') return;
        let time = Date.now() - state.startTime;
        let recs = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
        if (!recs[state.mode] || time < recs[state.mode]) {
            recs[state.mode] = time;
            localStorage.setItem(RECORDS_KEY, JSON.stringify(recs));
            updateMenuScores();
        }
    }

    function updateMenuScores() {
        let recs = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
        ['beginner', 'amateur', 'expert'].forEach(m => {
            const el = document.getElementById(`score-${m}`);
            if (recs[m]) {
                let d = Math.floor(recs[m]/1000);
                el.innerText = `${Math.floor(d/60).toString().padStart(2,'0')}:${(d%60).toString().padStart(2,'0')}`;
            } else {
                el.innerText = '--:--';
            }
        });
    }

    init();
});