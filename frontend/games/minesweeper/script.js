document.addEventListener('DOMContentLoaded', () => {
    // === 1. ИНИЦИАЛИЗАЦИЯ TELEGRAM ===
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();

    function haptic(type = 'medium') {
        if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
            tg.HapticFeedback.impactOccurred(type);
        }
    }

    // === 2. ХРАНИЛИЩЕ (Синхронизация Рекордов) ===
    const RECORDS_KEY = 'minesweeper_records_v2';
    let cloudStorage = tg.CloudStorage && tg.isVersionAtLeast('6.9') ? tg.CloudStorage : null;

    const StorageManager = {
        records: {
            beginner: null, // ms
            amateur: null,
            expert: null
        },

        loadRecords(callback) {
            // 1. Local
            try {
                const s = localStorage.getItem(RECORDS_KEY);
                if (s) this.records = JSON.parse(s);
            } catch (e) {}

            // 2. Cloud
            if (cloudStorage) {
                cloudStorage.getItem(RECORDS_KEY, (err, val) => {
                    if (!err && val) {
                        try {
                            const cloudRecs = JSON.parse(val);
                            // Merge: берем лучшее время
                            ['beginner', 'amateur', 'expert'].forEach(mode => {
                                if (cloudRecs[mode]) {
                                    if (!this.records[mode] || cloudRecs[mode] < this.records[mode]) {
                                        this.records[mode] = cloudRecs[mode];
                                    }
                                }
                            });
                            this.saveRecords(); // Sync back to local
                        } catch (e) {}
                    }
                    if (callback) callback();
                });
            } else if (callback) {
                callback();
            }
        },

        saveRecord(mode, timeMs) {
            if (!this.records[mode] || timeMs < this.records[mode]) {
                this.records[mode] = timeMs;
                const json = JSON.stringify(this.records);
                try { localStorage.setItem(RECORDS_KEY, json); } catch (e) {}
                if (cloudStorage) {
                    cloudStorage.setItem(RECORDS_KEY, json, (err) => { if (err) console.error(err); });
                }
                return true; // Новый рекорд!
            }
            return false;
        }
    };

    // === 3. КОНФИГУРАЦИЯ И UI ===
    const PRESETS = {
        beginner: { rows: 9, cols: 9, mines: 10 },
        amateur: { rows: 16, cols: 16, mines: 40 },
        expert: { rows: 16, cols: 30, mines: 99 } // 30 в ширину
    };

    const UI = {
        menuScreen: document.getElementById('menu-screen'),
        gameScreen: document.getElementById('game-screen'),
        grid: document.getElementById('grid'),
        minesCount: document.getElementById('mines-count'),
        timer: document.getElementById('timer'),
        faceBtn: document.getElementById('restart-btn'),
        backBtn: document.getElementById('back-to-menu-btn'),
        overlay: document.getElementById('result-overlay'),
        resultTitle: document.getElementById('result-title'),
        resultTime: document.getElementById('result-time'),
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
        currentMode: null, // 'beginner', 'amateur', 'expert', 'custom'
        grid: [],
        gameOver: false,
        gameWon: false,
        flags: 0,
        firstMove: true,
        startTime: null,
        endTime: null,
        timerInterval: null
    };

    // === 4. ИНИЦИАЛИЗАЦИЯ ===
    function init() {
        // Загрузка рекордов
        StorageManager.loadRecords(updateMenuScores);

        // Листенеры меню
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                startGame(mode, PRESETS[mode]);
            });
        });

        document.getElementById('start-custom-btn').addEventListener('click', startCustomGame);

        // Листенеры игры
        UI.faceBtn.addEventListener('click', restartGame);
        UI.backBtn.addEventListener('click', showMenu);
        UI.overlayRestartBtn.addEventListener('click', restartGame);
        UI.overlayMenuBtn.addEventListener('click', showMenu);
    }

    function updateMenuScores() {
        ['beginner', 'amateur', 'expert'].forEach(mode => {
            const el = document.getElementById(`score-${mode}`);
            if (StorageManager.records[mode]) {
                el.innerText = formatTime(StorageManager.records[mode]);
            } else {
                el.innerText = '--:--';
            }
        });
    }

    function startCustomGame() {
        let cols = parseInt(UI.inputs.cols.value) || 10;
        let rows = parseInt(UI.inputs.rows.value) || 10;
        let mines = parseInt(UI.inputs.mines.value) || 10;

        // Валидация
        cols = Math.min(99, Math.max(5, cols));
        rows = Math.min(99, Math.max(5, rows));

        const totalCells = cols * rows;
        if (mines >= totalCells) mines = totalCells - 1;
        if (mines < 1) mines = 1;

        startGame('custom', { rows, cols, mines });
    }

    // === 5. ЛОГИКА ИГРЫ ===
    function startGame(mode, config) {
        gameState.currentMode = mode;
        gameState.config = config;

        UI.menuScreen.classList.add('hidden');
        UI.gameScreen.classList.remove('hidden');
        UI.overlay.classList.add('hidden');

        resetGameVariables();
        renderGrid();
        updateHeader();
    }

    function restartGame() {
        resetGameVariables();
        UI.overlay.classList.add('hidden');
        renderGrid();
        updateHeader();
    }

    function showMenu() {
        stopTimer();
        UI.gameScreen.classList.add('hidden');
        UI.overlay.classList.add('hidden');
        UI.menuScreen.classList.remove('hidden');
        updateMenuScores();
    }

    function resetGameVariables() {
        stopTimer();
        gameState.gameOver = false;
        gameState.gameWon = false;
        gameState.firstMove = true;
        gameState.flags = gameState.config.mines;
        gameState.startTime = null;
        gameState.grid = createEmptyGrid();
        UI.faceBtn.innerText = '🙂';
        UI.timer.innerText = '00:00';
    }

    function createEmptyGrid() {
        let grid = [];
        const { rows, cols } = gameState.config;
        for (let y = 0; y < rows; y++) {
            let row = [];
            for (let x = 0; x < cols; x++) {
                row.push({ x, y, isMine: false, isOpen: false, isFlagged: false, count: 0 });
            }
            grid.push(row);
        }
        return grid;
    }

    function generateMines(safeX, safeY) {
        let minesPlaced = 0;
        const { rows, cols, mines } = gameState.config;

        while (minesPlaced < mines) {
            let rx = Math.floor(Math.random() * cols);
            let ry = Math.floor(Math.random() * rows);

            if (!gameState.grid[ry][rx].isMine) {
                // Защита первого хода (радиус 1)
                if (Math.abs(rx - safeX) <= 1 && Math.abs(ry - safeY) <= 1) continue;

                gameState.grid[ry][rx].isMine = true;
                minesPlaced++;
            }
        }

        // Подсчет соседей
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (!gameState.grid[y][x].isMine) {
                    gameState.grid[y][x].count = countNeighbors(x, y);
                }
            }
        }
    }

    function countNeighbors(x, y) {
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

    // === 6. ТАЙМЕР (ms) ===
    function startTimer() {
        gameState.startTime = Date.now();
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = setInterval(() => {
            const delta = Date.now() - gameState.startTime;
            UI.timer.innerText = formatTime(delta, false); // без ms для игры
        }, 100); // обновление 10 раз в сек
    }

    function stopTimer() {
        clearInterval(gameState.timerInterval);
        if (gameState.startTime) {
            gameState.endTime = Date.now() - gameState.startTime;
        }
    }

    function formatTime(ms, showMs = true) {
        if (!ms) return '00:00';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const msec = Math.floor((ms % 1000) / 10); // 2 digits

        const strMin = String(minutes).padStart(2, '0');
        const strSec = String(seconds).padStart(2, '0');

        if (showMs) {
            return `${strMin}:${strSec}:${String(msec).padStart(2, '0')}`;
        }
        return `${strMin}:${strSec}`;
    }

    function updateHeader() {
        UI.minesCount.innerText = String(gameState.flags).padStart(3, '0');
    }

    // === 7. РЕНДЕРИНГ И УПРАВЛЕНИЕ ===
    function renderGrid() {
        UI.grid.innerHTML = '';
        const { rows, cols } = gameState.config;

        // CSS Grid динамически
        UI.grid.style.gridTemplateColumns = `repeat(${cols}, 30px)`;

        gameState.grid.forEach(row => {
            row.forEach(cell => {
                const el = document.createElement('div');
                el.className = 'cell';
                el.dataset.x = cell.x;
                el.dataset.y = cell.y;

                attachEvents(el, cell);
                UI.grid.appendChild(el);
            });
        });
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
                el.innerText = cell.count;
                el.classList.add(`val-${cell.count}`);
            }
        } else if (cell.isFlagged) {
            el.classList.add('flagged');
            el.innerText = '🚩';
        }
    }

    function attachEvents(el, cell) {
        // Desktop
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) handleInteraction(cell, 'click');
            if (e.button === 2) { e.preventDefault(); toggleFlag(cell); }
        });
        el.addEventListener('contextmenu', e => e.preventDefault());

        // Mobile Touch
        let touchTimer = null;
        let startX, startY;
        let isDrag = false;

        el.addEventListener('touchstart', (e) => {
            if (gameState.gameOver) return;
            isDrag = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;

            touchTimer = setTimeout(() => {
                if (!isDrag) {
                    haptic('medium');
                    toggleFlag(cell);
                    isDrag = true; // чтобы не сработал click при touchend
                }
            }, 400); // 400ms hold
        }, { passive: false });

        el.addEventListener('touchmove', (e) => {
            // Если палец сдвинулся значительно, это скролл
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;
            if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
                clearTimeout(touchTimer);
                isDrag = true;
            }
        });

        el.addEventListener('touchend', (e) => {
            clearTimeout(touchTimer);
            if (!isDrag) {
                e.preventDefault(); // отменяем эмуляцию мыши
                handleInteraction(cell, 'click');
            }
        });
    }

    function handleInteraction(cell, type) {
        if (gameState.gameOver || gameState.gameWon) return;
        if (type === 'click') openCell(cell.x, cell.y);
    }

    function toggleFlag(cell) {
        if (gameState.gameOver || cell.isOpen) return;

        if (!cell.isFlagged && gameState.flags > 0) {
            cell.isFlagged = true;
            gameState.flags--;
        } else if (cell.isFlagged) {
            cell.isFlagged = false;
            gameState.flags++;
        }

        const el = getEl(cell.x, cell.y);
        if (el) updateCellVisual(el, cell);
        updateHeader();
    }

    function openCell(x, y) {
        const cell = gameState.grid[y][x];
        if (cell.isOpen || cell.isFlagged) return;

        if (gameState.firstMove) {
            gameState.firstMove = false;
            generateMines(x, y);
            startTimer();
        }

        cell.isOpen = true;
        const el = getEl(x, y);
        if (el) updateCellVisual(el, cell);

        if (cell.isMine) {
            gameOver(false);
        } else {
            if (cell.count === 0) floodFill(x, y);
            checkWin();
        }
    }

    function floodFill(x, y) {
        const { rows, cols } = gameState.config;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    const neighbor = gameState.grid[ny][nx];
                    if (!neighbor.isOpen && !neighbor.isMine) {
                        openCell(nx, ny);
                    }
                }
            }
        }
    }

    function checkWin() {
        let openCount = 0;
        gameState.grid.forEach(row => row.forEach(c => { if(c.isOpen) openCount++; }));

        const total = gameState.config.rows * gameState.config.cols;
        if (openCount === total - gameState.config.mines) {
            gameOver(true);
        }
    }

    function gameOver(win) {
        gameState.gameOver = true;
        gameState.gameWon = win;
        stopTimer();

        if (win) {
            UI.faceBtn.innerText = '😎';
            haptic('success');
            const finalTime = gameState.endTime;
            let isRecord = false;

            // Проверка рекорда только для пресетов
            if (['beginner', 'amateur', 'expert'].includes(gameState.currentMode)) {
                isRecord = StorageManager.saveRecord(gameState.currentMode, finalTime);
            }

            UI.resultTitle.innerText = isRecord ? "НОВЫЙ РЕКОРД!" : "ПОБЕДА!";
            UI.resultTime.innerText = formatTime(finalTime);
        } else {
            UI.faceBtn.innerText = '😵';
            haptic('error');
            UI.resultTitle.innerText = "ВЗРЫВ!";
            UI.resultTime.innerText = "--:--:--";

            // Показать мины
            gameState.grid.forEach(row => row.forEach(c => {
                if (c.isMine) {
                    c.isOpen = true;
                    const el = getEl(c.x, c.y);
                    if (el) updateCellVisual(el, c);
                }
            }));
        }

        setTimeout(() => UI.overlay.classList.remove('hidden'), 1000);
    }

    function getEl(x, y) {
        return document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    }

    init();
});