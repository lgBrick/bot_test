document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();

    // Haptic wrapper
    const haptic = (style) => {
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style);
    };

    // --- CONFIG & STATE ---
    const STORAGE_KEY_RECORDS = 'minesweeper_records_v2';
    const STORAGE_KEY_STATE = 'minesweeper_state_v2';

    const PRESETS = {
        novice: { rows: 9, cols: 9, mines: 10, name: 'Новичок' },
        amateur: { rows: 16, cols: 16, mines: 40, name: 'Любитель' },
        expert: { rows: 16, cols: 30, mines: 99, name: 'Эксперт' }
    };

    let gameState = {
        grid: [],
        config: {},
        status: 'menu', // menu, playing, won, lost
        startTime: 0,   // timestamp начала игры
        elapsedTime: 0, // накопленное время (если пауза/релоад)
        flagsPlaced: 0,
        firstMove: true
    };

    let timerInterval = null;
    let records = {};

    // --- DOM ELEMENTS ---
    const screens = {
        menu: document.getElementById('menu-screen'),
        game: document.getElementById('game-screen')
    };

    const ui = {
        grid: document.getElementById('grid'),
        minesCounter: document.getElementById('mines-count'),
        timer: document.getElementById('timer'),
        faceBtn: document.getElementById('face-btn'),
        overlay: document.getElementById('result-overlay'),
        resultTitle: document.getElementById('result-title'),
        resultTime: document.getElementById('result-time'),
        records: {
            novice: document.getElementById('rec-novice'),
            amateur: document.getElementById('rec-amateur'),
            expert: document.getElementById('rec-expert')
        }
    };

    // --- STORAGE MANAGER ---
    const Storage = {
        load() {
            // Загрузка рекордов
            const recs = localStorage.getItem(STORAGE_KEY_RECORDS);
            if (recs) records = JSON.parse(recs);

            // Попытка восстановить состояние
            const savedState = localStorage.getItem(STORAGE_KEY_STATE);
            if (savedState) {
                try {
                    const parsed = JSON.parse(savedState);
                    if (parsed.status === 'playing') {
                        restoreGame(parsed);
                        return true; // Восстановили
                    }
                } catch(e) { console.error(e); }
            }
            return false;
        },

        saveState() {
            if (gameState.status === 'playing') {
                // Обновляем прошедшее время перед сохранением
                const currentElapsed = gameState.elapsedTime + (Date.now() - gameState.startTime);
                const stateToSave = {
                    ...gameState,
                    elapsedTime: currentElapsed, // Сохраняем актуальное время
                    startTime: Date.now() // Сдвигаем старт, чтобы не дублировать
                };
                localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(stateToSave));
            } else {
                localStorage.removeItem(STORAGE_KEY_STATE);
            }
        },

        saveRecord(mode, time) {
            if (!PRESETS[mode]) return false; // Не сохраняем кастомные
            if (!records[mode] || time < records[mode]) {
                records[mode] = time;
                localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(records));
                // Sync with Cloud
                if (tg.CloudStorage) {
                    tg.CloudStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(records));
                }
                return true;
            }
            return false;
        }
    };

    // --- GAME LOGIC ---

    function init() {
        // Рендер рекордов в меню
        renderRecords();

        // Кнопки меню
        document.querySelectorAll('.menu-btn[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => startGame(btn.dataset.mode));
        });

        // Кастомная игра
        document.getElementById('start-custom').addEventListener('click', () => {
            const r = parseInt(document.getElementById('c-rows').value) || 10;
            const c = parseInt(document.getElementById('c-cols').value) || 10;
            const m = parseInt(document.getElementById('c-mines').value) || 10;
            // Валидация
            const rows = Math.min(30, Math.max(5, r));
            const cols = Math.min(30, Math.max(5, c));
            const mines = Math.min(rows * cols - 1, Math.max(1, m));

            startGame('custom', { rows, cols, mines });
        });

        // Кнопки в игре
        ui.faceBtn.addEventListener('click', () => {
            haptic('medium');
            startGame(gameState.config.mode, gameState.config);
        });

        document.getElementById('back-btn').addEventListener('click', showMenu);
        document.getElementById('restart-btn').addEventListener('click', () => {
             ui.overlay.classList.remove('visible');
             startGame(gameState.config.mode, gameState.config);
        });
        document.getElementById('menu-btn-over').addEventListener('click', () => {
            ui.overlay.classList.remove('visible');
            showMenu();
        });

        // Попытка восстановления
        if (!Storage.load()) {
            showMenu();
        } else {
            // Если восстановили, показываем экран игры
            screens.menu.classList.add('hidden');
            screens.game.classList.remove('hidden');
        }
    }

    function showMenu() {
        stopTimer();
        renderRecords();
        screens.game.classList.add('hidden');
        screens.menu.classList.remove('hidden');
        gameState.status = 'menu';
        Storage.saveState(); // очистит сохранение
    }

    function renderRecords() {
        for (let key in PRESETS) {
            if (ui.records[key]) {
                const ms = records[key];
                ui.records[key].innerText = ms ? formatTime(ms) : '--:--';
            }
        }
    }

    function startGame(mode, customConfig = null) {
        stopTimer();
        screens.menu.classList.add('hidden');
        screens.game.classList.remove('hidden');

        const cfg = customConfig || PRESETS[mode];
        gameState = {
            config: { ...cfg, mode }, // сохраняем mode
            grid: [],
            status: 'playing',
            startTime: 0,
            elapsedTime: 0,
            flagsPlaced: 0,
            firstMove: true
        };

        // Создаем пустую сетку
        createGrid();
        renderGridDOM();
        updateHeader();

        ui.faceBtn.innerText = '🙂';
        Storage.saveState();
    }

    function restoreGame(saved) {
        gameState = saved;
        // Восстанавливаем таймер
        gameState.startTime = Date.now(); // Считаем, что продолжили прямо сейчас
        startTimer();

        renderGridDOM();
        updateHeader();

        // Восстанавливаем визуал ячеек
        gameState.grid.forEach(row => row.forEach(cell => {
            const el = getCellEl(cell.x, cell.y);
            updateCellVisual(el, cell);
        }));
    }

    function createGrid() {
        const { rows, cols } = gameState.config;
        gameState.grid = [];
        for (let y = 0; y < rows; y++) {
            let row = [];
            for (let x = 0; x < cols; x++) {
                row.push({
                    x, y,
                    isMine: false,
                    isOpen: false,
                    isFlagged: false,
                    count: 0
                });
            }
            gameState.grid.push(row);
        }
    }

    // --- FAIR GENERATION (Без угадывания) ---
    function generateMines(safeX, safeY) {
        const { rows, cols, mines } = gameState.config;

        // 1. Сначала ставим мины случайно
        // 2. Считаем цифры
        // 3. Проверяем, является ли safeX, safeY нулем (пустым местом)
        // Если нет -> перегенерируем.
        // Это гарантирует "островок" безопасности при старте.

        let attempts = 0;
        let success = false;

        while (!success && attempts < 1000) {
            // Очистка
            for(let y=0; y<rows; y++)
                for(let x=0; x<cols; x++) {
                    gameState.grid[y][x].isMine = false;
                    gameState.grid[y][x].count = 0;
                }

            let minesPlaced = 0;
            while (minesPlaced < mines) {
                let rx = Math.floor(Math.random() * cols);
                let ry = Math.floor(Math.random() * rows);

                // Не ставим мину прямо под палец
                if (rx === safeX && ry === safeY) continue;

                if (!gameState.grid[ry][rx].isMine) {
                    gameState.grid[ry][rx].isMine = true;
                    minesPlaced++;
                }
            }

            // Считаем
            calcNumbers();

            // Проверка: клетка старта должна быть 0
            if (gameState.grid[safeY][safeX].count === 0) {
                success = true;
            }
            attempts++;
        }

        // Если за 1000 попыток не вышло (очень плотное поле), оставляем как есть,
        // но гарантируем, что под пальцем нет мины (это уже учтено выше)
    }

    function calcNumbers() {
        const { rows, cols } = gameState.config;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (!gameState.grid[y][x].isMine) {
                    gameState.grid[y][x].count = countMinesAround(x, y);
                }
            }
        }
    }

    function countMinesAround(x, y) {
        let count = 0;
        const { rows, cols } = gameState.config;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    if (gameState.grid[ny][nx].isMine) count++;
                }
            }
        }
        return count;
    }

    // --- RENDER ---
    function renderGridDOM() {
        ui.grid.innerHTML = '';
        const { rows, cols } = gameState.config;

        ui.grid.style.gridTemplateColumns = `repeat(${cols}, 32px)`;

        gameState.grid.forEach(row => {
            row.forEach(cell => {
                const el = document.createElement('div');
                el.className = 'cell';
                el.dataset.x = cell.x;
                el.dataset.y = cell.y;

                // Touch/Mouse handlers
                addInteractions(el, cell);
                ui.grid.appendChild(el);
            });
        });
    }

    function addInteractions(el, cell) {
        // Desktop Right Click
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            toggleFlag(cell);
        });

        // Click / Touch logic
        let touchTimer = null;
        let isLongPress = false;

        const startHandler = (e) => {
            if (gameState.status !== 'playing') return;
            isLongPress = false;

            // Если долгий тап -> флаг
            touchTimer = setTimeout(() => {
                isLongPress = true;
                haptic('medium');
                toggleFlag(cell);
            }, 400);
        };

        const endHandler = (e) => {
            clearTimeout(touchTimer);
            if (isLongPress) {
                e.preventDefault();
                return;
            }

            // Обычный клик
            if (cell.isOpen) {
                // CHORDING (Аккорд)
                handleChord(cell);
            } else {
                openCell(cell);
            }
        };

        // Mouse
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) startHandler(e);
        });
        el.addEventListener('mouseup', (e) => {
            if (e.button === 0) endHandler(e);
        });

        // Touch
        el.addEventListener('touchstart', startHandler, { passive: true });
        el.addEventListener('touchend', endHandler);
    }

    function updateCellVisual(el, cell) {
        el.className = 'cell';
        el.innerText = '';

        if (cell.isOpen) {
            el.classList.add('open');
            if (cell.isMine) {
                el.classList.add('mine');
                el.innerText = '💣';
            } else if (cell.count > 0) {
                el.classList.add(`val-${cell.count}`);
                el.innerText = cell.count;
            }
        } else {
            if (cell.isFlagged) {
                el.classList.add('flagged');
                el.innerText = '🚩';
            }
        }
    }

    function getCellEl(x, y) {
        // Используем querySelector для надежности или id
        // Оптимизация: можно хранить ссылки в матрице, но для 30x16 сойдет и так
        return ui.grid.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    }

    // --- ACTIONS ---

    function toggleFlag(cell) {
        if (cell.isOpen) return;

        if (!cell.isFlagged) {
            cell.isFlagged = true;
            gameState.flagsPlaced++;
        } else {
            cell.isFlagged = false;
            gameState.flagsPlaced--;
        }

        updateHeader();
        const el = getCellEl(cell.x, cell.y);
        updateCellVisual(el, cell);
        Storage.saveState();
    }

    function openCell(cell) {
        if (cell.isOpen || cell.isFlagged) return;

        if (gameState.firstMove) {
            gameState.firstMove = false;
            gameState.startTime = Date.now();
            startTimer();
            generateMines(cell.x, cell.y);
            // После генерации обновляем состояние текущей ячейки, т.к. она могла измениться
        }

        cell.isOpen = true;
        const el = getCellEl(cell.x, cell.y);
        updateCellVisual(el, cell);

        if (cell.isMine) {
            gameOver(false);
        } else {
            haptic('light');
            if (cell.count === 0) {
                openNeighbors(cell.x, cell.y);
            }
            checkWin();
            Storage.saveState();
        }
    }

    // РЕКУРСИВНОЕ ОТКРЫТИЕ (Flood Fill)
    function openNeighbors(x, y) {
        const { rows, cols } = gameState.config;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    const neighbor = gameState.grid[ny][nx];
                    if (!neighbor.isOpen && !neighbor.isMine) {
                        openCell(neighbor);
                    }
                }
            }
        }
    }

    // CHORDING (АККОРД)
    function handleChord(cell) {
        if (cell.count === 0) return;

        // 1. Считаем флаги вокруг
        let flagsAround = 0;
        const { rows, cols } = gameState.config;

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = cell.y + dy, nx = cell.x + dx;
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    if (gameState.grid[ny][nx].isFlagged) flagsAround++;
                }
            }
        }

        // 2. Если флагов столько же, сколько мин - открываем остальных
        if (flagsAround === cell.count) {
            let openedSomething = false;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    let ny = cell.y + dy, nx = cell.x + dx;
                    if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                        const neighbor = gameState.grid[ny][nx];
                        if (!neighbor.isOpen && !neighbor.isFlagged) {
                            openCell(neighbor);
                            openedSomething = true;
                        }
                    }
                }
            }
            if (openedSomething) haptic('medium');
        } else {
            // Визуальная подсказка (шейк или подсветка) - опционально
            // Можно добавить легкую вибрацию "отказ"
            haptic('error');
        }
    }

    function checkWin() {
        if (gameState.status !== 'playing') return;

        let openCount = 0;
        const { rows, cols, mines } = gameState.config;
        const total = rows * cols;

        gameState.grid.forEach(r => r.forEach(c => {
            if (c.isOpen) openCount++;
        }));

        if (openCount === total - mines) {
            gameOver(true);
        }
    }

    function gameOver(win) {
        gameState.status = win ? 'won' : 'lost';
        stopTimer();
        Storage.saveState(); // удалит стейт т.к. статус не playing

        const finalTimeMs = gameState.elapsedTime;

        if (win) {
            ui.faceBtn.innerText = '😎';
            haptic('success');

            const isRec = Storage.saveRecord(gameState.config.mode, finalTimeMs);
            ui.resultTitle.innerText = isRec ? "Новый рекорд!" : "Победа!";
            ui.resultTime.innerText = formatTime(finalTimeMs);
        } else {
            ui.faceBtn.innerText = '😵';
            haptic('error');
            ui.resultTitle.innerText = "Взрыв!";
            ui.resultTime.innerText = formatTime(finalTimeMs);

            // ПОКАЗАТЬ ВСЕ МИНЫ
            gameState.grid.forEach(row => row.forEach(cell => {
                const el = getCellEl(cell.x, cell.y);
                if (cell.isMine && !cell.isFlagged) {
                    cell.isOpen = true; // чтобы отрисовалась как открытая мина
                    el.classList.add('open', 'mine');
                    el.innerText = '💣';
                }
                else if (!cell.isMine && cell.isFlagged) {
                    // Неверный флаг
                    el.classList.add('wrong-flag');
                }
            }));
        }

        // Показать оверлей через секунду
        setTimeout(() => {
            ui.overlay.classList.add('visible');
        }, 1000);
    }

    // --- TIMER & UI ---
    function startTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const now = Date.now();
            const total = gameState.elapsedTime + (now - gameState.startTime);
            ui.timer.innerText = formatTime(total, false);

            // Сохраняем каждые 2 секунды на всякий случай
            if (Math.floor(total / 1000) % 2 === 0) Storage.saveState();
        }, 100);
    }

    function stopTimer() {
        clearInterval(timerInterval);
        if (gameState.status === 'playing' && gameState.startTime) {
            gameState.elapsedTime += Date.now() - gameState.startTime;
        }
    }

    function formatTime(ms, full = true) {
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');
        const mil = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
        return full ? `${m}:${s}:${mil}` : `${m}:${s}`;
    }

    function updateHeader() {
        const left = gameState.config.mines - gameState.flagsPlaced;
        ui.minesCounter.innerText = left.toString().padStart(3, '0');
    }

    init();
});