document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();

    function haptic(type = 'light') {
        if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
            tg.HapticFeedback.impactOccurred(type);
        }
    }

    // === КОНСТАНТЫ И НАСТРОЙКИ ===
    const RECORDS_KEY = 'minesweeper_records_v3';
    const PRESETS = {
        beginner: { rows: 9, cols: 9, mines: 10 },
        amateur: { rows: 16, cols: 16, mines: 40 },
        expert: { rows: 16, cols: 30, mines: 99 }
    };

    const UI = {
        menuScreen: document.getElementById('menu-screen'),
        gameScreen: document.getElementById('game-screen'),
        grid: document.getElementById('grid'),
        minesCount: document.getElementById('mines-count'),
        timer: document.getElementById('timer'),
        restartBtn: document.getElementById('restart-btn'),
        backBtn: document.getElementById('back-to-menu-btn'),
        overlay: document.getElementById('result-overlay'),
        resultTitle: document.getElementById('result-title'),
        resultTime: document.getElementById('result-time'),
        resultEmoji: document.getElementById('result-emoji'),
        overlayRestartBtn: document.getElementById('overlay-restart-btn'),
        overlayMenuBtn: document.getElementById('overlay-menu-btn'),
        inputs: {
            cols: document.getElementById('custom-cols'),
            rows: document.getElementById('custom-rows'),
            mines: document.getElementById('custom-mines')
        }
    };

    let gameState = {
        config: {},
        currentMode: null,
        grid: [], // 2D array of objects
        isGameOver: false,
        isGameWon: false,
        flagsUsed: 0,
        startTime: null,
        timerInterval: null
    };

    // === SOLVER (NO GUESS LOGIC) ===
    // Попытка создать решаемое поле. Если поле требует угадывания, пересоздаем.
    function generateSolvableBoard(startR, startC) {
        let attempts = 0;
        const maxAttempts = 50; // Защита от зависания

        while (attempts < maxAttempts) {
            attempts++;
            // 1. Создаем случайное поле
            let tempGrid = createBaseGrid();
            placeMinesRandomly(tempGrid, startR, startC);
            calculateNumbers(tempGrid);

            // 2. Пробуем решить его ботом
            if (isSolvable(tempGrid, startR, startC)) {
                return tempGrid; // Успех, поле решаемо логически
            }
        }

        // Если не удалось за 50 раз (редко для стандартных размеров),
        // возвращаем последнее сгенерированное (fallback)
        let fallbackGrid = createBaseGrid();
        placeMinesRandomly(fallbackGrid, startR, startC);
        calculateNumbers(fallbackGrid);
        return fallbackGrid;
    }

    function isSolvable(grid, startR, startC) {
        const rows = grid.length;
        const cols = grid[0].length;
        let changed = true;

        // Клонируем состояние "открыто/закрыто/флаг" для симуляции
        let simulation = grid.map(row => row.map(cell => ({
            ...cell,
            isOpen: false,
            isFlagged: false
        })));

        // Открываем стартовую точку (она гарантированно 0 по логике placeMines)
        openCellSim(simulation, startR, startC);

        while (changed) {
            changed = false;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const cell = simulation[r][c];
                    if (cell.isOpen && cell.count > 0) {
                        const neighbors = getNeighbors(simulation, r, c);
                        const hidden = neighbors.filter(n => !n.isOpen);
                        const flagged = neighbors.filter(n => n.isFlagged);

                        // Логика 1: Если количество скрытых == числу мин -> Флагируем все скрытые
                        // (Мины найдены)
                        if (hidden.length > 0 && hidden.length === cell.count - flagged.length) {
                            hidden.forEach(n => {
                                if (!n.isFlagged) {
                                    n.isFlagged = true;
                                    changed = true;
                                }
                            });
                        }

                        // Логика 2: Если количество флагов == числу мин -> Открываем остальные
                        // (Безопасные найдены)
                        if (flagged.length === cell.count && hidden.length > flagged.length) {
                            hidden.forEach(n => {
                                if (!n.isFlagged && !n.isOpen) {
                                    openCellSim(simulation, n.r, n.c);
                                    changed = true;
                                }
                            });
                        }
                    }
                }
            }
        }

        // Проверяем результат: решено, если все не-мины открыты
        let solved = true;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!simulation[r][c].isMine && !simulation[r][c].isOpen) {
                    solved = false;
                    break;
                }
            }
        }
        return solved;
    }

    function openCellSim(simGrid, r, c) {
        if (simGrid[r][c].isOpen || simGrid[r][c].isFlagged) return;
        simGrid[r][c].isOpen = true;

        if (simGrid[r][c].count === 0) {
            getNeighbors(simGrid, r, c).forEach(n => openCellSim(simGrid, n.r, n.c));
        }
    }

    function createBaseGrid() {
        const { rows, cols } = gameState.config;
        let grid = [];
        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) {
                row.push({
                    r, c,
                    isMine: false,
                    isOpen: false,
                    isFlagged: false,
                    count: 0
                });
            }
            grid.push(row);
        }
        return grid;
    }

    function placeMinesRandomly(grid, safeR, safeC) {
        const { rows, cols, mines } = gameState.config;
        let placed = 0;
        while (placed < mines) {
            let r = Math.floor(Math.random() * rows);
            let c = Math.floor(Math.random() * cols);

            // Не ставим мину в радиусе 1 от клика (гарантирует "0" на старте)
            if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;

            if (!grid[r][c].isMine) {
                grid[r][c].isMine = true;
                placed++;
            }
        }
    }

    function calculateNumbers(grid) {
        const rows = grid.length;
        const cols = grid[0].length;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!grid[r][c].isMine) {
                    grid[r][c].count = getNeighbors(grid, r, c).filter(n => n.isMine).length;
                }
            }
        }
    }

    function getNeighbors(grid, r, c) {
        let neighbors = [];
        const rows = grid.length;
        const cols = grid[0].length;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                let nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                    neighbors.push(grid[nr][nc]);
                }
            }
        }
        return neighbors;
    }

    // === ЛОГИКА ИГРЫ ===

    function init() {
        loadRecords();
        setupListeners();
        updateMenuScores();
    }

    function setupListeners() {
        // Меню
        document.querySelectorAll('.preset-card').forEach(btn => {
            btn.addEventListener('click', () => {
                haptic('light');
                startGame(btn.dataset.mode, PRESETS[btn.dataset.mode]);
            });
        });
        document.getElementById('start-custom-btn').addEventListener('click', () => {
            haptic('light');
            startCustomGame();
        });

        // Игра
        UI.restartBtn.addEventListener('click', () => { haptic('medium'); restartGame(); });
        UI.backBtn.addEventListener('click', () => { haptic('light'); showMenu(); });

        // Оверлей
        UI.overlayRestartBtn.addEventListener('click', () => { haptic('medium'); restartGame(); });
        UI.overlayMenuBtn.addEventListener('click', () => { haptic('light'); showMenu(); });
    }

    function startCustomGame() {
        let cols = parseInt(UI.inputs.cols.value) || 10;
        let rows = parseInt(UI.inputs.rows.value) || 10;
        let mines = parseInt(UI.inputs.mines.value) || 10;

        cols = Math.min(30, Math.max(5, cols));
        rows = Math.min(30, Math.max(5, rows));

        const total = cols * rows;
        mines = Math.min(total - 9, Math.max(1, mines)); // Оставляем место под старт

        startGame('custom', { rows, cols, mines });
    }

    function startGame(mode, config) {
        gameState.currentMode = mode;
        gameState.config = config;

        UI.menuScreen.classList.add('hidden');
        UI.gameScreen.classList.remove('hidden');
        UI.overlay.classList.add('hidden');

        resetGame(true);
    }

    function resetGame(fullReset = false) {
        stopTimer();
        gameState.isGameOver = false;
        gameState.isGameWon = false;
        gameState.flagsUsed = 0;
        gameState.startTime = null;

        // Создаем ПУСТУЮ сетку для отображения (мины сгенерируем при первом клике)
        // Это нужно, чтобы "No Guess" сработал от координат первого клика
        gameState.grid = createBaseGrid();

        renderGridHTML();
        updateHeader();
        UI.restartBtn.innerText = '🙂';
        UI.timer.innerText = '00:00';
    }

    function restartGame() {
        resetGame(false);
    }

    function showMenu() {
        stopTimer();
        UI.gameScreen.classList.add('hidden');
        UI.overlay.classList.add('hidden');
        UI.menuScreen.classList.remove('hidden');
        updateMenuScores();
    }

    // === РЕНДЕР ===
    function renderGridHTML() {
        UI.grid.innerHTML = '';
        const { rows, cols } = gameState.config;

        UI.grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;

        gameState.grid.forEach(row => {
            row.forEach(cell => {
                const el = document.createElement('div');
                el.className = 'cell';
                el.id = `c-${cell.r}-${cell.c}`;

                // Mouse/Touch events
                bindCellEvents(el, cell);
                UI.grid.appendChild(el);
            });
        });
    }

    function updateCellVisual(cell) {
        const el = document.getElementById(`c-${cell.r}-${cell.c}`);
        if (!el) return;

        el.className = 'cell';
        el.innerText = '';

        if (cell.isOpen) {
            el.classList.add('open');
            if (cell.isMine) {
                el.classList.add('mine');
                el.innerText = '💣';
            } else if (cell.count > 0) {
                el.innerText = cell.count;
                el.classList.add(`val-${cell.count}`);
            }
        } else if (cell.isFlagged) {
            el.classList.add('flagged');
            el.innerText = '🚩';
        }
    }

    function bindCellEvents(el, cell) {
        // Правый клик (десктоп)
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            toggleFlag(cell);
        });

        // Левый клик / Тап
        el.addEventListener('click', () => {
             handleClick(cell);
        });

        // Долгое нажатие для мобильных (флаг)
        let timer;
        el.addEventListener('touchstart', () => {
            timer = setTimeout(() => {
                haptic('medium');
                toggleFlag(cell);
            }, 300);
        }, {passive: true});

        el.addEventListener('touchend', () => clearTimeout(timer));
        el.addEventListener('touchmove', () => clearTimeout(timer));
    }

    // === ГЕЙМПЛЕЙ ===

    function handleClick(cell) {
        if (gameState.isGameOver || gameState.isGameWon) return;

        // 1. Если флаг - ничего не делаем
        if (cell.isFlagged) return;

        // 2. Если уже открыта -> попытка АККОРДА (Chording)
        if (cell.isOpen) {
            handleChord(cell);
            return;
        }

        // 3. Первый ход -> Генерируем поле
        if (!gameState.startTime) {
            // Генерируем "No Guess" поле относительно этой точки
            gameState.grid = generateSolvableBoard(cell.r, cell.c);

            // Перепривязываем объекты ячеек (так как grid заменился полностью)
            // Но в массиве gameState.grid уже новые объекты.
            // HTML элементы ссылаются на старые объекты в замыкании, поэтому обновляем визуализацию
            // Лучше просто продолжить работу с координатами.

            startTimer();
        }

        // Получаем актуальную ячейку из (возможно) новой сетки
        const currentCell = gameState.grid[cell.r][cell.c];
        openCellLogic(currentCell);
    }

    function openCellLogic(cell) {
        if (cell.isOpen || cell.isFlagged) return;

        cell.isOpen = true;
        updateCellVisual(cell);

        if (cell.isMine) {
            triggerGameOver(false);
            return;
        }

        // Если 0 - открываем соседей (Flood Fill)
        if (cell.count === 0) {
            getNeighbors(gameState.grid, cell.r, cell.c).forEach(n => openCellLogic(n));
        }

        checkWin();
    }

    // Реализация требования №2: Открытие соседей при клике на цифру
    function handleChord(cell) {
        if (cell.count === 0) return;

        const neighbors = getNeighbors(gameState.grid, cell.r, cell.c);
        const flags = neighbors.filter(n => n.isFlagged).length;

        // Если количество флагов совпадает с цифрой
        if (flags === cell.count) {
            let chordTriggered = false;
            neighbors.forEach(n => {
                if (!n.isOpen && !n.isFlagged) {
                    openCellLogic(n); // Открываем (если там мина без флага - бабах)
                    chordTriggered = true;
                }
            });
            if (chordTriggered) haptic('light');
        } else {
            // Визуальная подсказка (тряска или подсветка) можно добавить тут
        }
    }

    function toggleFlag(cell) {
        if (gameState.isGameOver || cell.isOpen) return;

        // Актуализируем ссылку на объект из грида
        const currentCell = gameState.grid[cell.r][cell.c];

        currentCell.isFlagged = !currentCell.isFlagged;
        gameState.flagsUsed += currentCell.isFlagged ? 1 : -1;

        updateCellVisual(currentCell);
        updateHeader();
        haptic('selection');
    }

    function checkWin() {
        const { rows, cols, mines } = gameState.config;
        let opened = 0;
        gameState.grid.forEach(row => row.forEach(c => { if(c.isOpen) opened++; }));

        if (opened === (rows * cols - mines)) {
            triggerGameOver(true);
        }
    }

    function triggerGameOver(win) {
        gameState.isGameOver = true;
        gameState.isGameWon = win;
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

            // Требование №4: Показать все мины
            revealAllMines();
        }

        UI.resultTime.innerText = UI.timer.innerText;
        setTimeout(() => UI.overlay.classList.remove('hidden'), 1000);
    }

    function revealAllMines() {
        gameState.grid.forEach(row => row.forEach(c => {
            if (c.isMine && !c.isFlagged) {
                // Мина, которую не нашли
                c.isOpen = true;
                updateCellVisual(c);
            } else if (!c.isMine && c.isFlagged) {
                // Неверный флаг
                const el = document.getElementById(`c-${c.r}-${c.c}`);
                if (el) el.classList.add('wrong-flag');
            }
        }));
    }

    // === УТИЛИТЫ ===
    function startTimer() {
        gameState.startTime = Date.now();
        gameState.timerInterval = setInterval(() => {
            const delta = Math.floor((Date.now() - gameState.startTime) / 1000);
            const m = Math.floor(delta / 60).toString().padStart(2, '0');
            const s = (delta % 60).toString().padStart(2, '0');
            UI.timer.innerText = `${m}:${s}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(gameState.timerInterval);
    }

    function updateHeader() {
        const left = gameState.config.mines - gameState.flagsUsed;
        UI.minesCount.innerText = left; // Можно уходить в минус
    }

    // Хранение рекордов (Local Storage)
    function saveRecord() {
        if (!gameState.startTime) return;
        const time = Date.now() - gameState.startTime;
        const mode = gameState.currentMode;

        if (!PRESETS[mode]) return; // Custom не сохраняем

        let records = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
        if (!records[mode] || time < records[mode]) {
            records[mode] = time;
            localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
            updateMenuScores();
        }
    }

    function loadRecords() {
        updateMenuScores();
    }

    function updateMenuScores() {
        const records = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
        ['beginner', 'amateur', 'expert'].forEach(mode => {
            const el = document.getElementById(`score-${mode}`);
            if (records[mode]) {
                const delta = Math.floor(records[mode] / 1000);
                const m = Math.floor(delta / 60).toString().padStart(2, '0');
                const s = (delta % 60).toString().padStart(2, '0');
                el.innerText = `${m}:${s}`;
            } else {
                el.innerText = '--:--';
            }
        });
    }

    init();
});