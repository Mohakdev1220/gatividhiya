"use strict";

/* ===============================
   Gatividhi Tracker — PRO BUILD (CLEAN & INTEGRATED)
   =============================== */

if (window.__gatividhiTrackerLoaded) {
    console.warn("Already loaded");
} else {
    window.__gatividhiTrackerLoaded = true;
}

/* ---------- Firebase Config ---------- */
const firebaseConfig = {
    apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
    authDomain: "gatividhiya.firebaseapp.com",
    projectId: "gatividhiya",
    storageBucket: "gatividhiya.firebasestorage.app",
    messagingSenderId: "305825266364",
    appId: "1:305825266364:web:b4e7b0921644f88b632eb9"
};

if (typeof firebase === "undefined") throw new Error("Firebase SDK not loaded");
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* ---------- Local State & Migration ---------- */
const STORAGE_KEY = "gatividhi_v1";

function getDefaultState() {
    return {
        theme: "dark",
        tasks: [],
        logs: {},
        graphOffset: 0,
        meta: { updatedAt: 0 }
    };
}

function normalizeState(input) {
    const base = getDefaultState();
    const source = input && typeof input === "object" ? input : {};

    base.theme = source.theme === "light" ? "light" : "dark";
    base.tasks = (Array.isArray(source.tasks) ? source.tasks : []).map(t => ({
        ...t,
        category: t.category || "General" // Phase 2 category upgrade
    }));
    base.logs = source.logs && typeof source.logs === "object" ? source.logs : {};
    base.graphOffset = Number.isFinite(Number(source.graphOffset)) ? Number(source.graphOffset) : 0;
    base.meta = source.meta && typeof source.meta === "object"
        ? { updatedAt: Number(source.meta.updatedAt || 0) }
        : { updatedAt: 0 };

    return base;
}

function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeState(JSON.parse(raw)) : getDefaultState();
    } catch {
        return getDefaultState();
    }
}

let state = loadLocal();

function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Global Helpers ---------- */
let activeCategoryFilter = "All";
function now() { return Date.now(); }

function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function monthKeyFromDateKey(dateKey) {
    if (!dateKey || typeof dateKey !== "string" || dateKey.length < 7) return todayKey().slice(0, 7);
    return dateKey.slice(0, 7);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setThemeOnDocument() {
    const theme = state.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
}

function ensureDateInputDefault() {
    const cal = document.getElementById("calInput");
    if (cal && !cal.value) cal.value = todayKey();
}

function isStatsVisible() {
    const stats = document.getElementById("statsView");
    return stats && stats.style.display !== "none";
}

/* ---------- Task Log Data Upgrades (Phase 2 fix) ---------- */
function getTaskLogData(dateKey, taskId) {
    const entry = state.logs?.[dateKey]?.[taskId];
    if (!entry) return { completed: false, durationMinutes: 0, notes: "" };
    if (typeof entry === "boolean") return { completed: entry, durationMinutes: 0, notes: "" };
    return {
        completed: Boolean(entry.completed),
        durationMinutes: Number(entry.durationMinutes || 0),
        notes: String(entry.notes || "")
    };
}

function setTaskLogData(dateKey, taskId, data) {
    if (!state.logs[dateKey]) state.logs[dateKey] = {};
    const existing = getTaskLogData(dateKey, taskId);
    state.logs[dateKey][taskId] = {
        completed: data.completed !== undefined ? data.completed : existing.completed,
        durationMinutes: data.durationMinutes !== undefined ? data.durationMinutes : existing.durationMinutes,
        notes: data.notes !== undefined ? data.notes : existing.notes
    };
    state.meta.updatedAt = now();
}

function isEntryCompleted(entry) {
    if (!entry) return false;
    return typeof entry === 'object' ? Boolean(entry.completed) : Boolean(entry);
}

/* ---------- Firestore Sync ---------- */
let saveTimer = null;
let unsubscribeCloud = null;

async function syncToCloud(reason = "update") {
    const user = auth.currentUser;
    if (!user) return;
    try {
        await db.collection("users").doc(user.uid).set({
            data: state,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            reason
        }, { merge: true });
    } catch (e) {
        console.error("Firestore sync error:", e);
    }
}

function scheduleSync(reason = "update") {
    saveLocal();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => syncToCloud(reason), 250);
}

async function loadFromCloud(user) {
    try {
        const doc = await db.collection("users").doc(user.uid).get();
        if (doc.exists && doc.data()?.data) {
            state = normalizeState(doc.data().data);
            saveLocal();
            setThemeOnDocument();
            renderTasks();
            if (isStatsVisible()) renderStats();
        } else {
            await syncToCloud("first-save");
        }
    } catch (e) {
        console.error("Load error:", e);
    }
}

function listenToCloud(user) {
    if (unsubscribeCloud) unsubscribeCloud();
    unsubscribeCloud = db.collection("users").doc(user.uid).onSnapshot((doc) => {
        if (!doc.exists) return;
        const cloud = doc.data()?.data;
        if (!cloud) return;
        const normalized = normalizeState(cloud);
        if (JSON.stringify(normalized) === JSON.stringify(state)) return;
        
        state = normalized;
        saveLocal();
        setThemeOnDocument();
        renderTasks();
        if (isStatsVisible()) renderStats();
    });
}

/* ---------- Auth ---------- */
function setAuthUI(user) {
    const loginBtn = document.getElementById("login-btn");
    const userInfo = document.getElementById("user-info");
    const userPic = document.getElementById("user-pic");
    const userName = document.getElementById("user-name");

    if (!loginBtn || !userInfo) return;
    if (user) {
        loginBtn.style.display = "none";
        userInfo.style.display = "flex";
        if (userName) userName.textContent = user.displayName || user.email || "Signed in";
        if (userPic) {
            if (user.photoURL) {
                userPic.src = user.photoURL;
                userPic.style.display = "block";
            } else {
                userPic.removeAttribute("src");
                userPic.style.display = "none";
            }
        }
    } else {
        loginBtn.style.display = "block";
        userInfo.style.display = "none";
    }
}

auth.onAuthStateChanged(async (user) => {
    setAuthUI(user);
    if (user) {
        try { await user.reload(); } catch {}
        await loadFromCloud(user);
        listenToCloud(user);
    } else if (unsubscribeCloud) {
        unsubscribeCloud();
        unsubscribeCloud = null;
    }
});

window.handleLogin = async function () {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope("email");
        provider.addScope("profile");
        provider.setCustomParameters({ prompt: "select_account" });
        const res = await auth.signInWithPopup(provider);
        if (res.user) try { await res.user.reload(); } catch {}
    } catch (e) {
        console.error("Login error:", e);
    }
};

window.handleLogout = async function () {
    await auth.signOut();
};

/* ---------- UI Toggles & Clock ---------- */
window.quickAdd = function (name) {
    const input = document.getElementById("tName");
    if (!input) return;
    input.value = name;
    input.focus();
};

window.switchView = function (view) {
    document.getElementById("tab-track")?.classList.toggle("active", view === "track");
    document.getElementById("tab-stats")?.classList.toggle("active", view === "stats");
    document.getElementById("trackView").style.display = view === "track" ? "block" : "none";
    document.getElementById("statsView").style.display = view === "stats" ? "block" : "none";
    if (view === "stats") renderStats();
};

window.toggleTheme = function () {
    state.theme = state.theme === "dark" ? "light" : "dark";
    state.meta.updatedAt = now();
    setThemeOnDocument();
    saveLocal();
    scheduleSync("theme-toggle");
};

function startClock() {
    const tick = () => {
        const current = new Date();
        const timeEl = document.getElementById("liveTime");
        const dateEl = document.getElementById("liveDate");
        if (timeEl) timeEl.textContent = current.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        if (dateEl) dateEl.textContent = current.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" }).toUpperCase();
    };
    tick();
    setInterval(tick, 1000);
}

/* ---------- Tasks & Category Filter ---------- */
window.setCategoryFilter = function (cat) {
    activeCategoryFilter = cat;
    document.querySelectorAll(".cat-chip").forEach((btn) => {
        btn.classList.toggle("active", btn.textContent.trim() === cat);
    });
    renderTasks();
};

window.addTask = function () {
    const nameEl = document.getElementById("tName");
    const targetEl = document.getElementById("tTarget");
    const catEl = document.getElementById("tCategory");
    const calEl = document.getElementById("calInput");

    if (!nameEl || !targetEl || !calEl) return;
    const name = String(nameEl.value || "").trim();
    const targetRaw = Number(targetEl.value);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : 30;
    const category = catEl ? catEl.value : "General";
    const month = monthKeyFromDateKey(calEl.value || todayKey());

    if (!name) return alert("Enter activity name");

    state.tasks.push({ id: now(), name, target, category, month, createdAt: now(), updatedAt: now() });
    state.meta.updatedAt = now();

    nameEl.value = "";
    targetEl.value = "";
    
    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("add-task");
};

window.toggleTask = function (id) {
    const calEl = document.getElementById("calInput");
    const date = calEl?.value || todayKey();
    const log = getTaskLogData(date, id);
    
    setTaskLogData(date, id, { completed: !log.completed });
    
    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("toggle-task");
};

/* ---------- Edit / Delete Modals ---------- */
let editingTaskId = null;
let deletingTaskId = null;

window.openEditModal = function (id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    editingTaskId = id;
    
    const editName = document.getElementById("editName");
    const editTarget = document.getElementById("editTarget");
    const editCat = document.getElementById("editCategory");
    
    if (editName) editName.value = task.name || "";
    if (editTarget) editTarget.value = String(task.target || 30);
    if (editCat) editCat.value = task.category || "General";
    
    document.getElementById("editModal")?.classList.add("show");
};

window.openDeleteModal = function (id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    deletingTaskId = id;
    document.getElementById("deleteModal")?.classList.add("show");
};

window.closeModals = function () {
    document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.remove("show"));
    editingTaskId = null;
    deletingTaskId = null;
};

function handleSaveEdit() {
    if (editingTaskId == null) return;
    const task = state.tasks.find(t => t.id === editingTaskId);
    if (!task) return window.closeModals();

    const name = String(document.getElementById("editName")?.value || "").trim();
    const targetRaw = Number(document.getElementById("editTarget")?.value);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : task.target;
    const category = document.getElementById("editCategory")?.value || "General";

    if (!name) return alert("Activity name cannot be empty.");

    task.name = name;
    task.target = target;
    task.category = category;
    task.updatedAt = now();
    state.meta.updatedAt = now();

    window.closeModals();
    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("edit-task");
}

function purgeTaskFromLogs(taskId) {
    Object.keys(state.logs || {}).forEach((dateKey) => {
        if (taskId in state.logs[dateKey]) delete state.logs[dateKey][taskId];
        if (Object.keys(state.logs[dateKey]).length === 0) delete state.logs[dateKey];
    });
}

function handleConfirmDelete() {
    if (deletingTaskId == null) return;
    state.tasks = state.tasks.filter(t => t.id !== deletingTaskId);
    purgeTaskFromLogs(deletingTaskId);
    state.meta.updatedAt = now();
    window.closeModals();
    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("delete-task");
}

/* ---------- Rendering UI ---------- */
function countTaskChecksInMonth(taskId, month) {
    let total = 0;
    Object.keys(state.logs || {}).forEach((dateKey) => {
        if (!dateKey.startsWith(month)) return;
        if (isEntryCompleted(state.logs[dateKey]?.[taskId])) total += 1;
    });
    return total;
}

function countCompletedTasksForDate(dateKey) {
    const dateLogs = state.logs?.[dateKey] || {};
    return Object.values(dateLogs).filter(isEntryCompleted).length;
}

function renderTasks() {
    const list = document.getElementById("taskList");
    if (!list) return;

    const calEl = document.getElementById("calInput");
    const date = calEl?.value || todayKey();
    const month = monthKeyFromDateKey(date);
    
    populateTimerSelect(); // Sync Timer dropdown

    let tasksForMonth = state.tasks.filter(t => t.month === month);
    if (activeCategoryFilter !== "All") {
        tasksForMonth = tasksForMonth.filter(t => (t.category || "General") === activeCategoryFilter);
    }

    list.innerHTML = "";
    if (tasksForMonth.length === 0) {
        list.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--text-dim);">No activities found.</div>`;
        return;
    }

    tasksForMonth.forEach((task) => {
        const log = getTaskLogData(date, task.id);
        const isChecked = log.completed;
        const monthChecks = countTaskChecksInMonth(task.id, month);
        const progress = task.target > 0 ? Math.min(100, Math.round((monthChecks / task.target) * 100)) : 0;
        const cat = task.category || "General";

        const item = document.createElement("div");
        item.className = "item";

        let logPills = "";
        if (log.durationMinutes) logPills += `<span class="time-pill">⏱️ ${log.durationMinutes}m</span>`;
        if (log.notes) logPills += `<span class="note-pill" title="${escapeHtml(log.notes)}">📝 Note</span>`;

        item.innerHTML = `
            <div style="min-width:0; flex:1;">
                <div style="font-weight:800; font-size:1rem; margin-bottom:6px; word-break:break-word;">
                    ${escapeHtml(task.name)}
                    <span class="cat-badge cat-${cat}">${cat}</span>
                </div>
                <div style="font-size:0.8rem; color: var(--text-dim); margin-bottom:8px;">
                    ${monthChecks}/${task.target} days this month
                </div>
                <div style="height:6px; background: var(--bg); border-radius:999px; overflow:hidden; max-width:220px;">
                    <div style="height:100%; width:${progress}%; background: var(--success); border-radius:999px;"></div>
                </div>
                <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                    <button type="button" onclick="openEditModal(${task.id})" style="padding:6px 10px; border:none; border-radius:999px; background:rgba(59,130,246,0.15); color:var(--accent); font-weight:800; cursor:pointer;">Edit</button>
                    <button type="button" onclick="openDeleteModal(${task.id})" style="padding:6px 10px; border:none; border-radius:999px; background:rgba(239,68,68,0.14); color:var(--danger); font-weight:800; cursor:pointer;">Delete</button>
                    ${logPills}
                </div>
            </div>
            <label class="switch" title="Mark done">
                <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleTask(${task.id})">
                <span class="slider"></span>
            </label>
        `;
        list.appendChild(item);
    });
}

window.refreshUI = function () {
    renderTasks();
    if (isStatsVisible()) renderStats();
};

/* ---------- Charts & Heatmap ---------- */
let lineChart = null, pieChart = null;
function destroyCharts() {
    if (lineChart) lineChart.destroy();
    if (pieChart) pieChart.destroy();
    lineChart = null; pieChart = null;
}

window.changeGraphRange = function (delta) {
    state.graphOffset = Number(state.graphOffset || 0) + (delta * 7);
    state.meta.updatedAt = now();
    saveLocal();
    renderStats();
    scheduleSync("graph-range");
};

function renderHeatmap() {
    const container = document.getElementById("heatmapContainer");
    if (!container) return;
    container.innerHTML = "";

    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay()); // Align to previous Sunday

    const grid = document.createElement("div");
    grid.className = "heatmap-grid";

    let current = new Date(start);
    while (current <= end) {
        const key = todayKey(current);
        const count = countCompletedTasksForDate(key);
        let lvl = 0;
        if (count >= 1 && count <= 2) lvl = 1;
        else if (count >= 3 && count <= 4) lvl = 2;
        else if (count >= 5 && count <= 6) lvl = 3;
        else if (count >= 7) lvl = 4;

        const tile = document.createElement("div");
        tile.className = `heatmap-tile lvl-${lvl}`;
        tile.title = `${key}: ${count} activity check(s)`;
        grid.appendChild(tile);
        current.setDate(current.getDate() + 1);
    }
    container.appendChild(grid);
}

function renderStats() {
    const canvasLine = document.getElementById("lineChart");
    const canvasPie = document.getElementById("pieChart");
    if (!canvasLine || !canvasPie || typeof Chart === "undefined") return;
    destroyCharts();
    renderHeatmap(); 

    const offset = Number(state.graphOffset || 0);
    const dates = [], labels = [], values = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + offset);

    for (let i = 6; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);
        const key = todayKey(d);
        dates.push(key);
        labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
        values.push(countCompletedTasksForDate(key));
    }

    const rangeLabel = document.getElementById("rangeLabel");
    if (rangeLabel) {
        const startDate = new Date(base);
        startDate.setDate(base.getDate() - 6);
        rangeLabel.textContent = `${startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} — ${base.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
    }

    lineChart = new Chart(canvasLine.getContext("2d"), {
        type: "line",
        data: { labels, datasets: [{ label: "Completed", data: values, borderWidth: 3, tension: 0.35, fill: true }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });

    const dateKey = document.getElementById("calInput")?.value || todayKey();
    const month = monthKeyFromDateKey(dateKey);
    const monthTasks = state.tasks.filter(task => task.month === month);
    
    let totalFocusMins = 0;
    Object.keys(state.logs || {}).forEach(k => {
        if (k.startsWith(month)) {
            Object.values(state.logs[k]).forEach(log => {
                if (typeof log === 'object' && log.durationMinutes) totalFocusMins += Number(log.durationMinutes);
            });
        }
    });
    const hrs = document.getElementById("totalFocusHours");
    if (hrs) hrs.textContent = `${(totalFocusMins / 60).toFixed(1)} hrs`;

    const doneCount = monthTasks.filter(task => isEntryCompleted(state.logs?.[dateKey]?.[task.id])).length;
    const pendingCount = Math.max(0, monthTasks.length - doneCount);

    pieChart = new Chart(canvasPie.getContext("2d"), {
        type: "doughnut",
        data: { labels: ["Done", "Pending"], datasets: [{ data: [doneCount, pendingCount] }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom" } } }
    });

    const monthList = document.getElementById("monthList");
    if (monthList) {
        const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();
        monthList.innerHTML = `<div class="card"><div style="font-weight:800; font-size:1rem; margin-bottom:8px;">Monthly Summary</div></div>`;
        months.forEach((m) => {
            const tasks = state.tasks.filter(t => t.month === m);
            const completed = tasks.reduce((sum, task) => sum + countTaskChecksInMonth(task.id, m), 0);
            const target = tasks.reduce((sum, task) => sum + Number(task.target || 0), 0);
            const button = document.createElement("button");
            button.className = "month-summary-card";
            button.innerHTML = `<div class="month-summary-top"><div><div class="month-summary-name">${escapeHtml(m)}</div><div class="month-summary-sub">${tasks.length} activities</div></div><div class="month-summary-score">${completed}/${target}</div></div>`;
            button.addEventListener("click", () => showMonthDetails(m));
            monthList.appendChild(button);
        });
    }
}

/* ---------- Modals: Month Summary ---------- */
window.showMonthDetails = function (monthKey) {
    const modal = document.getElementById("monthDetailModal");
    const content = document.getElementById("monthModalContent");
    const tasks = state.tasks.filter(task => task.month === monthKey);
    document.getElementById("monthModalTitle").textContent = monthKey;
    content.innerHTML = tasks.length === 0 ? `<div class="month-activity-card" style="text-align:center;">No activities.</div>` : "";
    
    tasks.forEach((task) => {
        const completed = countTaskChecksInMonth(task.id, monthKey);
        const target = task.target > 0 ? Math.floor(task.target) : 0;
        const progress = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
        const card = document.createElement("div");
        card.className = "month-activity-card";
        card.innerHTML = `<div class="month-activity-name">${escapeHtml(task.name)}</div><div class="month-activity-meta">${completed}/${target} days this month</div><div style="height:6px; background:var(--bg); border-radius:999px; margin-top:10px;"><div style="height:100%; width:${progress}%; background:var(--success); border-radius:999px;"></div></div>`;
        content.appendChild(card);
    });
    modal.classList.add("show");
};

window.hideMonthModal = function () { document.getElementById("monthDetailModal")?.classList.remove("show"); };
window.closeMonthModal = function (event) { if (event.target.id === "monthDetailModal") hideMonthModal(); };

/* ---------- Focus Timer Logic ---------- */
let timerInterval = null, timerSeconds = 25 * 60, isTimerRunning = false, currentPresetMinutes = 25;

window.setTimerPreset = function(mins) {
    if (isTimerRunning) pauseTimer();
    currentPresetMinutes = mins;
    timerSeconds = mins * 60;
    updateTimerDisplay();
};

function updateTimerDisplay() {
    const display = document.getElementById("timerDisplay");
    if (!display) return;
    const m = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
    const s = (timerSeconds % 60).toString().padStart(2, '0');
    display.textContent = `${m}:${s}`;
}

window.toggleTimer = function() { isTimerRunning ? pauseTimer() : startTimer(); };

function startTimer() {
    if (isTimerRunning) return;
    isTimerRunning = true;
    document.getElementById("timerToggleBtn").textContent = "Pause";
    document.getElementById("timerDisplay").classList.add("running");

    timerInterval = setInterval(() => {
        if (currentPresetMinutes > 0) {
            timerSeconds--;
            if (timerSeconds <= 0) {
                pauseTimer();
                alert("⏰ Focus Session Complete! Excellent work.");
                window.openSessionModalFromTimer();
            }
        } else {
            timerSeconds++; // Stopwatch
        }
        updateTimerDisplay();
    }, 1000);
}

function pauseTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
    document.getElementById("timerToggleBtn").textContent = "Start Focus";
    document.getElementById("timerDisplay").classList.remove("running");
}

window.resetTimer = function() {
    pauseTimer();
    timerSeconds = currentPresetMinutes * 60;
    updateTimerDisplay();
};

function populateTimerSelect() {
    const select = document.getElementById("timerTaskSelect");
    if (!select) return;
    const month = monthKeyFromDateKey(document.getElementById("calInput")?.value || todayKey());
    const currentVal = select.value;
    select.innerHTML = `<option value="">-- Select Activity to Focus On --</option>`;
    state.tasks.filter(t => t.month === month).forEach(task => {
        const opt = document.createElement("option");
        opt.value = task.id;
        opt.textContent = `[${task.category || 'General'}] ${task.name}`;
        select.appendChild(opt);
    });
    select.value = currentVal;
}

window.openSessionModalFromTimer = function() {
    const taskId = document.getElementById("timerTaskSelect")?.value;
    if (!taskId) return alert("Please select an activity from the dropdown first.");
    const minutesSpent = Math.max(1, Math.round((currentPresetMinutes > 0 ? (currentPresetMinutes * 60 - timerSeconds) : timerSeconds) / 60));
    window.openSessionModal(Number(taskId), minutesSpent);
};

window.openSessionModal = function(taskId, defaultMins = 0) {
    const date = document.getElementById("calInput")?.value || todayKey();
    const log = getTaskLogData(date, taskId);
    document.getElementById("sessionTaskId").value = taskId;
    document.getElementById("sessionDuration").value = defaultMins || log.durationMinutes || "";
    document.getElementById("sessionNotes").value = log.notes || "";
    document.getElementById("sessionModal").classList.add("show");
};

window.saveSessionModal = function() {
    const taskId = Number(document.getElementById("sessionTaskId").value);
    const mins = Number(document.getElementById("sessionDuration").value || 0);
    const notes = String(document.getElementById("sessionNotes").value || "").trim();
    const date = document.getElementById("calInput")?.value || todayKey();

    setTaskLogData(date, taskId, { completed: true, durationMinutes: mins, notes: notes });
    window.closeModals();
    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("log-session");
};

/* ---------- Exports / Imports ---------- */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

let toastTimer = null;
function showExportToast(msg, isError = false) {
    let toast = document.getElementById("exportToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "exportToast";
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = "export-toast" + (isError ? " export-toast-err" : "");
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

window.openExportModal = () => document.getElementById("exportImportModal")?.classList.add("show");
window.closeExportModal = () => document.getElementById("exportImportModal")?.classList.remove("show");

window.exportJSON = function () {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: 2, data: state }, null, 2)], { type: "application/json" });
    triggerDownload(blob, `gatividhi-backup-${todayKey()}.json`);
    showExportToast("JSON exported ✓");
};

window.exportTXT = function () {
    const lines = ["╔══════════════════════════════════════╗", "║     GATIVIDHI TRACKER — EXPORT       ║", "╚══════════════════════════════════════╝", `Exported on : ${new Date().toLocaleString("en-IN")}`, `Total tasks : ${state.tasks.length}\n`];
    const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();
    months.forEach(month => {
        lines.push(`━━━━  ${month}  ━━━━`);
        state.tasks.filter(t => t.month === month).forEach(task => {
            const done = countTaskChecksInMonth(task.id, month);
            const pct = task.target > 0 ? Math.round((done / task.target) * 100) : 0;
            const bar = "█".repeat(Math.round((pct/100)*20)) + "░".repeat(20 - Math.round((pct/100)*20));
            lines.push(`  • ${task.name}\n    Progress : [${bar}] ${pct}%  (${done}/${task.target} days)`);
        });
        lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, `gatividhi-export-${todayKey()}.txt`);
    showExportToast("TXT exported ✓");
};

window.exportCSV = function () {
    const rows = [["Month", "Category", "Task Name", "Target Days", "Days Completed", "Progress %", "Created At"]];
    state.tasks.forEach(task => {
        const done = countTaskChecksInMonth(task.id, task.month);
        const pct = task.target > 0 ? Math.round((done / task.target) * 100) : 0;
        rows.push([task.month, task.category || "General", `"${task.name.replace(/"/g, '""')}"`, task.target, done, pct, new Date(task.createdAt).toLocaleDateString("en-IN")]);
    });
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `gatividhi-tasks-${todayKey()}.csv`);
    showExportToast("CSV exported ✓");
};

window.exportPDF = function () {
    if (typeof window.jspdf === "undefined" || typeof window.jspdf.jsPDF === "undefined") {
        showExportToast("Loading PDF engine…");
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        s.onload = () => buildAndDownloadPDF();
        s.onerror = () => showExportToast("PDF load failed — try again");
        document.head.appendChild(s);
        return;
    }
    buildAndDownloadPDF();
};
/* ---------- Date Navigation Helper ---------- */
window.shiftDate = function (days) {
    const calEl = document.getElementById("calInput");
    if (!calEl) return;

    // Get current input date or default to today
    const val = calEl.value || todayKey();
    const [year, month, day] = val.split("-").map(Number);

    // Shift date by added days in local time
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);

    // Update calendar input value
    calEl.value = todayKey(date);

    // Refresh UI with the updated date
    renderTasks();
    if (isStatsVisible()) renderStats();
};

function buildAndDownloadPDF() {
    if (typeof window.jspdf === "undefined") return showExportToast("PDF engine not ready — try again");
    
    // MISSING INITIALIZATION FIXED:
    const doc = new window.jspdf.jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const MARGIN = 18, COL = W - MARGIN * 2, accent = [59, 130, 246], success = [16, 185, 129], dimGrey = [120, 130, 150], dark = [20, 24, 32];
    let y = 20;

    doc.setFillColor(...accent); doc.rect(0, 0, W, 28, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(255, 255, 255); doc.text("Gatividhi Tracker", MARGIN, 13);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.text("Exported: " + new Date().toLocaleString("en-IN"), W - MARGIN, 22, { align: "right" });
    
    y = 36;
    const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();
    months.forEach(month => {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...accent); doc.text(month, MARGIN, y);
        doc.setDrawColor(...accent); doc.setLineWidth(0.4); doc.line(MARGIN + 22, y - 1, MARGIN + COL, y - 1); y += 6;
        
        state.tasks.filter(t => t.month === month).forEach(task => {
            if (y > 270) { doc.addPage(); y = 20; }
            const done = countTaskChecksInMonth(task.id, month);
            const pct = task.target > 0 ? Math.min(100, Math.round((done / task.target) * 100)) : 0;
            doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...dark); doc.text(`[${task.category || 'Gen'}] ${task.name}`, MARGIN, y);
            doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...dimGrey); doc.text(`${done}/${task.target} days  •  ${pct}%`, W - MARGIN, y, { align: "right" });
            y += 4;
            doc.setFillColor(220, 226, 236); doc.roundedRect(MARGIN, y, COL, 3.5, 1.5, 1.5, "F");
            if (pct > 0) { doc.setFillColor(...success); doc.roundedRect(MARGIN, y, COL * (pct / 100), 3.5, 1.5, 1.5, "F"); }
            y += 8;
        });
        y += 4;
    });

    doc.save(`gatividhi-report-${todayKey()}.pdf`);
    showExportToast("PDF exported ✓");
}

window.importJSON = function () {
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = ".json,application/json"; fileInput.style.display = "none";
    fileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            const incoming = parsed.data || parsed;
            if (!incoming.tasks || !Array.isArray(incoming.tasks)) return showExportToast("Invalid file ✗", true);
            const normalized = normalizeState(incoming);
            if (!window.confirm("Import tasks and logs? This will MERGE with current data.")) return;
            
            const existingIds = new Set(state.tasks.map(t => String(t.id)));
            const newTasks = normalized.tasks.filter(t => !existingIds.has(String(t.id)));
            state.tasks = [...state.tasks, ...newTasks];
            
            Object.keys(normalized.logs || {}).forEach(date => {
                if (!state.logs[date]) state.logs[date] = {};
                Object.assign(state.logs[date], normalized.logs[date]);
            });
            state.meta.updatedAt = Date.now();
            saveLocal(); scheduleSync("import-json"); renderTasks(); if (isStatsVisible()) renderStats();
            showExportToast(`Imported ${newTasks.length} new tasks ✓`);
        } catch (err) { showExportToast("Parse error ✗", true); }
    };
    document.body.appendChild(fileInput); fileInput.click();
    setTimeout(() => fileInput.remove(), 5000);
};

/* ---------- Init & Bindings ---------- */
function bindModalButtons() {
    document.getElementById("saveEditBtn")?.addEventListener("click", handleSaveEdit);
    document.getElementById("confirmDelBtn")?.addEventListener("click", handleConfirmDelete);
    document.querySelectorAll(".modal-overlay").forEach(m => m.addEventListener("click", (e) => { if (e.target === m) window.closeModals(); }));
}

document.addEventListener("DOMContentLoaded", () => {
    setThemeOnDocument();
    ensureDateInputDefault();
    startClock();
    bindModalButtons();
    renderTasks();
});
