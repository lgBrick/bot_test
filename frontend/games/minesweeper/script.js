document.addEventListener('DOMContentLoaded', () => {
    // === 1. ИНИЦИАЛИЗАЦИЯ ===
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();

    function haptic(type = 'medium') {
        if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
            tg.HapticFeedback.impactOccurred(type);
        }
    }

    // === 2. ХРАНИЛИЩЕ ===
    // Используем уникальные ключи для разных размеров поля, если нужно,
    // но пока используем общий, так как параметры приходят извне или дефолтные.
    const STORAGE_KEY = 'minesweeper_game_v2';

    const StorageManager = {
        saveState(state) {
            // Перед сохранением обновляем elapsed, чтобы не потерять секунды
            if (state.startTime) {
                state.elapsedTime += Math.floor((Date.now() - state.startTime) / 1000);
                state.startTime = Date.now(); // Сброс базы для следующего отрезка
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        },
        getState() {
            try {
                return JSON.parse(localStorage.getItem(STORAGE_KEY));
            } catch (e) { return null; }
        },
        clearState() {
            localStorage.removeItem(STORAGE_KEY);
        }
    };

    // Читаем параметры из URL (если игра запускается в iframe с параметрами)
    // Или используем дефолт.
    const urlParams = new URLSearchParams(window.location.search);
    const CONFIG = {
        rows: parseInt(urlParams.get('rows')) || 10,
        cols: parseInt(urlParams.get('cols')) || 10,
        mines: parseInt(urlParams.get('mines')) || 15
    };

    const UI = {
        grid: document.getElementById('grid'),
        minesCount: document.getElementById('mines-count'),
        timer: document.getElementById('timer'),
        faceBtn: document.getElementById('restart-btn'),
        overlay: document.getElementById('result-overlay'),
        resultTitle: document.getElementById('result-title'),
        overlayBtn: document.getElementById('overlay-restart-btn')
    };

    let gameState = {
        grid: [],
        status: 'new', // new, playing, won, lost
        timer: 0,
        elapsedTime: 0, // Накопленное время в секундах
        startTime: null, // Timestamp начала текущей сессии
        flags: CONFIG.mines
    };

    let timerInterval = null;

    function init() {
        UI.faceBtn.addEventListener('click', startNewGame);
        UI.overlayBtn.addEventListener('click', startNewGame);

        // CSS Grid
        UI.grid.style.gridTemplateColumns = `repeat(${CONFIG.cols}, 34px)`; // 34px = ширина cell

        const saved = StorageManager.getState();
        // Восстанавливаем, только если конфиг совпадает и игра не закончена
        if (saved && saved.status === 'playing' &&
            saved.grid.length === CONFIG.rows && saved.grid[0].length === CONFIG.cols) {
            restoreGame(saved);
        } else {
            startNewGame();
        }
    }

    function startNewGame() {
        stopTimer();
        gameState = {
            grid: createEmptyGrid(),
            status: 'new',
            elapsedTime: 0,
            startTime: null,
            flags: CONFIG.mines
        };
        UI.overlay.classList.remove('visible');
        UI.faceBtn.innerText = '🙂';
        updateHeader();
        renderGrid();
        StorageManager.clearState();
    }

    function restoreGame(saved) {
        gameState = saved;
        gameState.startTime = Date.now(); // Продолжаем отсчет с текущего момента
        updateHeader();
        renderGrid();
        startTimer();
    }

    function createEmptyGrid() {
        let grid = [];
        for (let y = 0; y < CONFIG.rows; y++) {
            let row = [];
            for (let x = 0; x < CONFIG.cols; x++) {
                row.push({ x, y, isMine: false, isOpen: false, isFlagged: false, count: 0 });
            }
            grid.push(row);
        }
        return grid;
    }

    // === ГЕНЕРАЦИЯ (FAIR PLAY) ===
    // Гарантирует, что safeX, safeY будет "0" (пустой областью)
    function generateMines(safeX, safeY) {
        let attempts = 0;
        let success = false;

        // Пытаемся сгенерировать поле, где клик попадает в 0
        while (!success && attempts < 1000) {
            // Очистка
            for(let y=0; y<CONFIG.rows; y++)
                for(let x=0; x<CONFIG.cols; x++) {
                    gameState.grid[y][x].isMine = false;
                    gameState.grid[y][x].count = 0;
                }

            let minesPlaced = 0;
            while (minesPlaced < CONFIG.mines) {
                let rx = Math.floor(Math.random() * CONFIG.cols);
                let ry = Math.floor(Math.random() * CONFIG.rows);

                // Не ставим мину прямо в точку клика и её соседей (на всякий случай)
                if (Math.abs(rx - safeX) <= 1 && Math.abs(ry - safeY) <= 1) continue;

                if (!gameState.grid[ry][rx].isMine) {
                    gameState.grid[ry][rx].isMine = true;
                    minesPlaced++;
                }
            }

            // Считаем цифры
            calculateNumbers();

            // Проверка: точка старта должна быть 0
            if (gameState.grid[safeY][safeX].count === 0) {
                success = true;
            }
            attempts++;
        }
    }

    function calculateNumbers() {
        for (let y = 0; y < CONFIG.rows; y++) {
            for (let x = 0; x < CONFIG.cols; x++) {
                if (!gameState.grid[y][x].isMine) {
                    gameState.grid[y][x].count = countMinesAround(x, y);
                }
            }
        }
    }

    function countMinesAround(x, y) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < CONFIG.rows && nx >= 0 && nx < CONFIG.cols) {
                    if (gameState.grid[ny][nx].isMine) count++;
                }
            }
        }
        return count;
    }

    // === ТАЙМЕР ===
    function startTimer() {
        if (!gameState.startTime) gameState.startTime = Date.now();

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const now = Date.now();
            const totalSeconds = gameState.elapsedTime + Math.floor((now - gameState.startTime) / 1000);

            UI.timer.innerText = String(totalSeconds).padStart(3, '0');

            // Автосейв раз в 2 секунды
            if (totalSeconds % 2 === 0) StorageManager.saveState(gameState);
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
        if (gameState.startTime) {
            gameState.elapsedTime += Math.floor((Date.now() - gameState.startTime) / 1000);
            gameState.startTime = null;
        }
    }

    function updateHeader() {
        UI.minesCount.innerText = String(gameState.flags).padStart(3, '0');
        const currentSec = gameState.elapsedTime; // Грубое отображение при загрузке
        UI.timer.innerText = String(currentSec).padStart(3, '0');
    }

    // === РЕНДЕР И СОБЫТИЯ ===
    function renderGrid() {
        UI.grid.innerHTML = '';
        gameState.grid.forEach(row => {
            row.forEach(cell => {
                const el = document.createElement('div');
                el.className = 'cell';
                el.dataset.x = cell.x;
                el.dataset.y = cell.y;
                updateCellVisual(el, cell);
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
        } else {
            if (cell.isFlagged) {
                el.classList.add('flagged');
                el.innerText = '🚩';
            }
        }
    }

    function attachEvents(el, cell) {
        // ПК: Правый клик
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            toggleFlag(cell);
        });

        // Touch Logic (Long press)
        let touchTimer = null;
        let isLongPress = false;

        const startTouch = (e) => {
            if (gameState.status === 'won' || gameState.status === 'lost') return;
            isLongPress = false;
            touchTimer = setTimeout(() => {
                isLongPress = true;
                haptic('medium');
                toggleFlag(cell);
            }, 400); // 400ms для флага
        };

        const endTouch = (e) => {
            clearTimeout(touchTimer);
            if (isLongPress) {
                if(e.cancelable) e.preventDefault();
                return;
            }
            // Обычный клик
            handleClick(cell);
        };

        el.addEventListener('touchstart', startTouch, { passive: true });
        el.addEventListener('touchend', endTouch);
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) handleClick(cell);
        });
    }

    // === ОСНОВНАЯ ЛОГИКА КЛИКА ===
    function handleClick(cell) {
        if (gameState.status === 'won' || gameState.status === 'lost') return;

        // Если ячейка открыта -> пробуем АККОРД (открытие соседей)
        if (cell.isOpen) {
            tryChord(cell);
            return;
        }

        // Если флаг -> ничего не делаем
        if (cell.isFlagged) return;

        // Первый ход
        if (gameState.status === 'new') {
            gameState.status = 'playing';
            startTimer();
            generateMines(cell.x, cell.y);
            // После генерации состояние ячейки могло измениться, но координаты те же
        }

        openCell(cell);
    }

    function openCell(cell) {
        if (cell.isOpen || cell.isFlagged) return;

        cell.isOpen = true;
        const el = document.querySelector(`.cell[data-x="${cell.x}"][data-y="${cell.y}"]`);
        if(el) updateCellVisual(el, cell);

        if (cell.isMine) {
            gameOver(false);
        } else {
            if (cell.count === 0) {
                openNeighbors(cell.x, cell.y);
            }
            checkWin();
            StorageManager.saveState(gameState);
        }
    }

    function openNeighbors(x, y) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < CONFIG.rows && nx >= 0 && nx < CONFIG.cols) {
                    const neighbor = gameState.grid[ny][nx];
                    if (!neighbor.isOpen) openCell(neighbor);
                }
            }
        }
    }

    // Логика "Аккорда" (Chording)
    function tryChord(cell) {
        if (cell.count === 0) return;

        // Считаем флаги вокруг
        let flags = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = cell.y + dy, nx = cell.x + dx;
                if (ny >= 0 && ny < CONFIG.rows && nx >= 0 && nx < CONFIG.cols) {
                    if (gameState.grid[ny][nx].isFlagged) flags++;
                }
            }
        }

        // Если флагов хватает, открываем остальных соседей
        if (flags === cell.count) {
            let opened = false;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    let ny = cell.y + dy, nx = cell.x + dx;
                    if (ny >= 0 && ny < CONFIG.rows && nx >= 0 && nx < CONFIG.cols) {
                        const neighbor = gameState.grid[ny][nx];
                        if (!neighbor.isOpen && !neighbor.isFlagged) {
                            openCell(neighbor);
                            opened = true;
                        }
                    }
                }
            }
            if (opened) haptic('light');
        } else {
            // Можно добавить анимацию тряски, если флагов не хватает
        }
    }

    function toggleFlag(cell) {
        if (gameState.status !== 'playing' && gameState.status !== 'new') return;
        if (cell.isOpen) return;

        if (!cell.isFlagged && gameState.flags > 0) {
            cell.isFlagged = true;
            gameState.flags--;
        } else if (cell.isFlagged) {
            cell.isFlagged = false;
            gameState.flags++;
        }

        updateHeader();
        const el = document.querySelector(`.cell[data-x="${cell.x}"][data-y="${cell.y}"]`);
        if (el) updateCellVisual(el, cell);
        StorageManager.saveState(gameState);
    }

    function checkWin() {
        let openCount = 0;
        gameState.grid.forEach(row => row.forEach(c => {
            if (c.isOpen) openCount++;
        }));

        const totalCells = CONFIG.rows * CONFIG.cols;
        if (openCount === totalCells - CONFIG.mines) {
            gameOver(true);
        }
    }

    function gameOver(win) {
        gameState.status = win ? 'won' : 'lost';
        stopTimer();
        StorageManager.clearState();

        if (win) {
            UI.faceBtn.innerText = '😎';
            haptic('success');
            UI.resultTitle.innerText = "Победа!";
        } else {
            UI.faceBtn.innerText = '😵';
            haptic('error');
            UI.resultTitle.innerText = "Взрыв!";

            // Показываем ВСЕ мины и ошибки
            gameState.grid.forEach(row => row.forEach(c => {
                const el = document.querySelector(`.cell[data-x="${c.x}"][data-y="${c.y}"]`);
                if (!el) return;

                if (c.isMine && !c.isFlagged) {
                    c.isOpen = true; // Для визуализации
                    el.classList.add('open', 'mine');
                    el.innerText = '💣';
                }
                else if (!c.isMine && c.isFlagged) {
                    // Неверный флаг
                    el.classList.add('wrong-flag');
                }
            }));
        }

        setTimeout(() => {
            UI.overlay.classList.add('visible');
        }, 1000);
    }

    init();
});