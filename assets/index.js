"use strict";

/* ===============================
   Gatividhi Tracker — PRO BUILD (CLEAN)
   =============================== */

/* ---------- 0) Prevent duplicate ---------- */
if (window.__gatividhiTrackerLoaded) {
    console.warn("Already loaded");
} else {
    window.__gatividhiTrackerLoaded = true;
}

/* ---------- 1) Firebase Config ---------- */
const firebaseConfig = {
    apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
    authDomain: "gatividhiya.firebaseapp.com",
    projectId: "gatividhiya",
    storageBucket: "gatividhiya.firebasestorage.app",
    messagingSenderId: "305825266364",
    appId: "1:305825266364:web:b4e7b0921644f88b632eb9"
};

/* ---------- 2) Init ---------- */
if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK not loaded");
}
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

/* ---------- 3) Local State ---------- */
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
    base.tasks = Array.isArray(source.tasks) ? source.tasks : [];
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

/* ---------- 4) Helpers ---------- */
function now() {
    return Date.now();
}

function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function monthKeyFromDateKey(dateKey) {
    if (!dateKey || typeof dateKey !== "string" || dateKey.length < 7) {
        return todayKey().slice(0, 7);
    }
    return dateKey.slice(0, 7);
}

function getUser() {
    return auth.currentUser;
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
    if (cal && !cal.value) {
        cal.value = todayKey();
    }
}

function isStatsVisible() {
    const stats = document.getElementById("statsView");
    return stats && stats.style.display !== "none";
}

function setAuthUI(user) {
    const loginBtn = document.getElementById("login-btn");
    const userInfo = document.getElementById("user-info");
    const userPic = document.getElementById("user-pic");
    const userName = document.getElementById("user-name");

    if (!loginBtn || !userInfo) return;

    if (user) {
        loginBtn.style.display = "none";
        userInfo.style.display = "flex";

        if (userName) {
            userName.textContent = user.displayName || user.email || "Signed in";
        }

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

/* ---------- 5) Firestore Sync ---------- */
let saveTimer = null;
let unsubscribeCloud = null;
let editingTaskId = null;
let deletingTaskId = null;
let lineChart = null;
let pieChart = null;

async function syncToCloud(reason = "update") {
    const user = auth.currentUser;
    if (!user) return;

    try {
        await db.collection("users").doc(user.uid).set({
            data: state,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            reason
        }, { merge: true });

        console.log("☁️ Synced:", reason);
    } catch (e) {
        console.error("Firestore sync error:", e);
    }
}

function scheduleSync(reason = "update") {
    saveLocal();

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        syncToCloud(reason);
    }, 250);
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
            console.log("☁️ Loaded from cloud");
        } else {
            await syncToCloud("first-save");
        }
    } catch (e) {
        console.error("Load error:", e);
    }
}

function listenToCloud(user) {
    if (unsubscribeCloud) {
        unsubscribeCloud();
        unsubscribeCloud = null;
    }

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

        console.log("🔄 Synced from cloud");
    });
}

/* ---------- 6) Auth ---------- */
auth.onAuthStateChanged(async (user) => {
    console.log("AUTH:", user);

    setAuthUI(user);

    if (user) {
        try {
            await user.reload();
        } catch {
            console.warn("reload failed");
        }

        console.log("EMAIL:", user.email || user.providerData?.[0]?.email || null);

        await loadFromCloud(user);
        listenToCloud(user);
    } else {
        if (unsubscribeCloud) {
            unsubscribeCloud();
            unsubscribeCloud = null;
        }
    }
});

/* ---------- 7) Login / Logout ---------- */
window.handleLogin = async function () {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope("email");
        provider.addScope("profile");
        provider.setCustomParameters({ prompt: "select_account" });

        const res = await auth.signInWithPopup(provider);

        if (res.user) {
            try {
                await res.user.reload();
            } catch {}
        }

        console.log("LOGIN SUCCESS:", res.user);
    } catch (e) {
        console.error("Login error:", e);
    }
};

window.handleLogout = async function () {
    await auth.signOut();
};

/* ---------- 8) UI Functions ---------- */
window.quickAdd = function (name) {
    const input = document.getElementById("tName");
    if (!input) return;

    input.value = name;
    input.focus();
};

window.switchView = function (view) {
    const trackTab = document.getElementById("tab-track");
    const statsTab = document.getElementById("tab-stats");
    const trackView = document.getElementById("trackView");
    const statsView = document.getElementById("statsView");

    if (!trackTab || !statsTab || !trackView || !statsView) return;

    trackTab.classList.toggle("active", view === "track");
    statsTab.classList.toggle("active", view === "stats");

    trackView.style.display = view === "track" ? "block" : "none";
    statsView.style.display = view === "stats" ? "block" : "none";

    if (view === "stats") {
        renderStats();
    }
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
        const timeEl = document.getElementById("liveTime");
        const dateEl = document.getElementById("liveDate");
        const current = new Date();

        if (timeEl) {
            timeEl.textContent = current.toLocaleTimeString("en-US", {
                hour12: true,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
        }

        if (dateEl) {
            dateEl.textContent = current.toLocaleDateString("en-US", {
                weekday: "long",
                day: "numeric",
                month: "short"
            }).toUpperCase();
        }
    };

    tick();
    setInterval(tick, 1000);
}

/* ---------- 9) Task CRUD ---------- */
window.addTask = function () {
    const nameEl = document.getElementById("tName");
    const targetEl = document.getElementById("tTarget");
    const calEl = document.getElementById("calInput");

    if (!nameEl || !targetEl || !calEl) return;

    const name = String(nameEl.value || "").trim();
    const targetRaw = Number(targetEl.value);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : 30;
    const month = monthKeyFromDateKey(calEl.value || todayKey());

    if (!name) {
        alert("Enter name");
        return;
    }

    state.tasks.push({
        id: now(),
        name,
        target,
        month,
        createdAt: now(),
        updatedAt: now()
    });

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

    if (!state.logs) state.logs = {};
    if (!state.logs[date]) state.logs[date] = {};

    state.logs[date][id] = !state.logs[date][id];
    state.meta.updatedAt = now();

    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("toggle-task");
};

function purgeTaskFromLogs(taskId) {
    Object.keys(state.logs || {}).forEach((dateKey) => {
        const day = state.logs[dateKey];
        if (!day || typeof day !== "object") return;

        if (taskId in day) {
            delete day[taskId];
        }

        if (Object.keys(day).length === 0) {
            delete state.logs[dateKey];
        }
    });
}

window.openEditModal = function (id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    editingTaskId = id;

    const editName = document.getElementById("editName");
    const editTarget = document.getElementById("editTarget");
    const editModal = document.getElementById("editModal");

    if (editName) editName.value = task.name || "";
    if (editTarget) editTarget.value = String(task.target || 30);
    if (editModal) editModal.classList.add("show");
};

window.openDeleteModal = function (id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    deletingTaskId = id;

    const deleteModal = document.getElementById("deleteModal");
    if (deleteModal) deleteModal.classList.add("show");
};

window.closeModals = function () {
    document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.remove("show"));
    editingTaskId = null;
    deletingTaskId = null;
};

function handleSaveEdit() {
    if (editingTaskId == null) return;

    const task = state.tasks.find(t => t.id === editingTaskId);
    if (!task) {
        window.closeModals();
        return;
    }

    const editName = document.getElementById("editName");
    const editTarget = document.getElementById("editTarget");

    const name = String(editName?.value || "").trim();
    const targetRaw = Number(editTarget?.value);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : task.target;

    if (!name) {
        alert("Activity name cannot be empty.");
        return;
    }

    task.name = name;
    task.target = target;
    task.updatedAt = now();
    state.meta.updatedAt = now();

    window.closeModals();
    renderTasks();
    if (isStatsVisible()) renderStats();
    scheduleSync("edit-task");
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

/* ---------- 10) Render ---------- */
function countTaskChecksInMonth(taskId, month) {
    let total = 0;

    Object.keys(state.logs || {}).forEach((dateKey) => {
        if (!dateKey.startsWith(month)) return;
        if (state.logs[dateKey]?.[taskId]) total += 1;
    });

    return total;
}

function countCompletedTasksForDate(dateKey) {
    const dateLogs = state.logs?.[dateKey] || {};
    return Object.values(dateLogs).filter(Boolean).length;
}

function getTasksForMonth(month) {
    return state.tasks.filter(t => t.month === month);
}

function get7DayRange(offsetDays = 0) {
    const dates = [];
    const labels = [];
    const values = [];

    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + offsetDays);

    for (let i = 6; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);

        const key = todayKey(d);
        dates.push(key);
        labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
        values.push(countCompletedTasksForDate(key));
    }

    return { dates, labels, values };
}

function renderTasks() {
    const list = document.getElementById("taskList");
    if (!list) return;

    const calEl = document.getElementById("calInput");
    const date = calEl?.value || todayKey();
    const month = monthKeyFromDateKey(date);

    const tasksForMonth = state.tasks.filter(t => t.month === month);

    list.innerHTML = "";

    if (tasksForMonth.length === 0) {
        list.innerHTML = `
            <div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--text-dim);">
                No activities for this month.
            </div>
        `;
        return;
    }

    tasksForMonth.forEach((task) => {
        const isChecked = Boolean(state.logs?.[date]?.[task.id]);
        const monthChecks = countTaskChecksInMonth(task.id, month);
        const progress = task.target > 0 ? Math.min(100, Math.round((monthChecks / task.target) * 100)) : 0;

        const item = document.createElement("div");
        item.className = "item";

        item.innerHTML = `
            <div style="min-width:0; flex:1;">
                <div style="font-weight:800; font-size:1rem; margin-bottom:6px; word-break:break-word;">
                    ${escapeHtml(task.name)}
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

function destroyCharts() {
    if (lineChart) {
        lineChart.destroy();
        lineChart = null;
    }
    if (pieChart) {
        pieChart.destroy();
        pieChart = null;
    }
}

window.changeGraphRange = function (delta) {
    state.graphOffset = Number(state.graphOffset || 0) + (delta * 7);
    state.meta.updatedAt = now();
    saveLocal();
    renderStats();
    scheduleSync("graph-range");
};

function renderStats() {
    const canvasLine = document.getElementById("lineChart");
    const canvasPie = document.getElementById("pieChart");
    const rangeLabel = document.getElementById("rangeLabel");
    const monthList = document.getElementById("monthList");

    if (!canvasLine || !canvasPie || typeof Chart === "undefined") return;

    destroyCharts();

    const offset = Number(state.graphOffset || 0);
    const { labels, values } = get7DayRange(offset);

    if (rangeLabel) {
        const endDate = new Date();
        endDate.setHours(0, 0, 0, 0);
        endDate.setDate(endDate.getDate() + offset);

        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - 6);

        const fmt = (d) => d.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short"
        });

        rangeLabel.textContent = `${fmt(startDate)} — ${fmt(endDate)}`;
    }

    lineChart = new Chart(canvasLine.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Completed",
                data: values,
                borderWidth: 3,
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });

const dateKey = document.getElementById("calInput")?.value || todayKey();
const month = monthKeyFromDateKey(dateKey);
const monthTasks = getTasksForMonth(month);

const dayLogs = state.logs?.[dateKey] || {};

const availableTasks = monthTasks.filter(task => task.month === month);

const doneCount = availableTasks.filter(
    task => dayLogs[task.id] === true
).length;

const pendingCount = Math.max(
    0,
    availableTasks.length - doneCount
);

pieChart = new Chart(canvasPie.getContext("2d"), {
    type: "doughnut",
    data: {
        labels: ["Done", "Pending"],
        datasets: [{ data: [doneCount, pendingCount] }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
            legend: { position: "bottom" }
        }
    }
});
    if (monthList) {
        const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();

        monthList.innerHTML = `
            <div class="card">
                <div style="font-weight:800; font-size:1rem; margin-bottom:8px;">Monthly Summary</div>
                <div style="color:var(--text-dim); font-size:0.9rem;">
                    ${monthTasks.length} activities in the selected month.
                </div>
            </div>
        `;

        months.forEach((m) => {
            const tasks = getTasksForMonth(m);
            const completed = tasks.reduce((sum, task) => sum + countTaskChecksInMonth(task.id, m), 0);
            const target = tasks.reduce((sum, task) => sum + Number(task.target || 0), 0);

            const button = document.createElement("button");
            button.type = "button";
            button.className = "month-summary-card";
            button.innerHTML = `
                <div class="month-summary-top">
                    <div>
                        <div class="month-summary-name">${escapeHtml(m)}</div>
                        <div class="month-summary-sub">${tasks.length} activities</div>
                    </div>
                    <div class="month-summary-score">${completed}/${target}</div>
                </div>
            `;

            button.addEventListener("click", () => showMonthDetails(m));
            monthList.appendChild(button);
        });
    }
}

window.refreshUI = function () {
    renderTasks();
    if (isStatsVisible()) renderStats();
};

/* ---------- 11) Month Details Modal ---------- */
function getMonthTasks(monthKey) {
    return state.tasks.filter(task => task.month === monthKey);
}

function getTaskCompletedCountInMonth(taskId, monthKey) {
    let total = 0;

    Object.keys(state.logs || {}).forEach((dateKey) => {
        if (!dateKey.startsWith(monthKey)) return;
        if (state.logs[dateKey]?.[taskId]) total += 1;
    });

    return total;
}

window.showMonthDetails = function (monthKey) {
    const modal = document.getElementById("monthDetailModal");
    const title = document.getElementById("monthModalTitle");
    const content = document.getElementById("monthModalContent");

    if (!modal || !title || !content) return;

    const tasks = getMonthTasks(monthKey);

    title.textContent = monthKey;
    content.innerHTML = "";

    if (tasks.length === 0) {
        content.innerHTML = `
            <div class="month-activity-card" style="text-align:center; color:var(--text-dim);">
                No activities in this month.
            </div>
        `;
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        return;
    }

    tasks.forEach((task) => {
        const completed = getTaskCompletedCountInMonth(task.id, monthKey);
        const target = Number.isFinite(Number(task.target)) && Number(task.target) > 0
            ? Math.floor(Number(task.target))
            : 0;

        const progress = target > 0
            ? Math.min(100, Math.round((completed / target) * 100))
            : 0;

        const card = document.createElement("div");
        card.className = "month-activity-card";
        card.innerHTML = `
            <div class="month-activity-name">${escapeHtml(task.name)}</div>
            <div class="month-activity-meta">
                ${completed}/${target} days this month
            </div>
            <div style="height:6px; background:var(--bg); border-radius:999px; overflow:hidden; margin-top:10px;">
                <div style="height:100%; width:${progress}%; background:var(--success); border-radius:999px;"></div>
            </div>
        `;
        content.appendChild(card);
    });

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
};

window.hideMonthModal = function () {
    const modal = document.getElementById("monthDetailModal");
    if (!modal) return;

    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
};

window.closeMonthModal = function (event) {
    if (event && event.target && event.target.id === "monthDetailModal") {
        hideMonthModal();
    }
};

/* ---------- 12) Modal buttons ---------- */
function bindModalButtons() {
    const saveEditBtn = document.getElementById("saveEditBtn");
    const confirmDelBtn = document.getElementById("confirmDelBtn");
    const editModal = document.getElementById("editModal");
    const deleteModal = document.getElementById("deleteModal");

    if (saveEditBtn && !saveEditBtn.dataset.bound) {
        saveEditBtn.dataset.bound = "1";
        saveEditBtn.addEventListener("click", handleSaveEdit);
    }

    if (confirmDelBtn && !confirmDelBtn.dataset.bound) {
        confirmDelBtn.dataset.bound = "1";
        confirmDelBtn.addEventListener("click", handleConfirmDelete);
    }

    if (editModal && !editModal.dataset.bound) {
        editModal.dataset.bound = "1";
        editModal.addEventListener("click", (e) => {
            if (e.target === editModal) window.closeModals();
        });
    }

    if (deleteModal && !deleteModal.dataset.bound) {
        deleteModal.dataset.bound = "1";
        deleteModal.addEventListener("click", (e) => {
            if (e.target === deleteModal) window.closeModals();
        });
    }
}

/* ---------- 13) Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 App Ready");
    setThemeOnDocument();
    ensureDateInputDefault();
    startClock();
    bindModalButtons();
    renderTasks();
});
/* ===============================
   Gatividhi Tracker — Export / Import
   ADD THIS CODE at the bottom of assets/index.js
   (before the last closing comment / DOMContentLoaded call)
   =============================== */

/* ──────────────────────────────────────────────────────────────
   EXPORT — JSON
   ────────────────────────────────────────────────────────────── */
window.exportJSON = function () {
    const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(blob, `gatividhi-backup-${todayKey()}.json`);
    showExportToast("JSON exported ✓");
};

/* ──────────────────────────────────────────────────────────────
   EXPORT — TXT
   ────────────────────────────────────────────────────────────── */
window.exportTXT = function () {
    const lines = [];
    lines.push("╔══════════════════════════════════════╗");
    lines.push("║     GATIVIDHI TRACKER — EXPORT       ║");
    lines.push("╚══════════════════════════════════════╝");
    lines.push(`Exported on : ${new Date().toLocaleString("en-IN")}`);
    lines.push(`Total tasks : ${state.tasks.length}`);
    lines.push("");

    const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();

    months.forEach(month => {
        const tasks = state.tasks.filter(t => t.month === month);
        lines.push(`━━━━  ${month}  ━━━━`);
        tasks.forEach(task => {
            const done = countTaskChecksInMonth(task.id, month);
            const pct = task.target > 0 ? Math.round((done / task.target) * 100) : 0;
            const bar = buildTextBar(pct, 20);
            lines.push(`  • ${task.name}`);
            lines.push(`    Progress : [${bar}] ${pct}%  (${done}/${task.target} days)`);
        });
        lines.push("");
    });

    lines.push("── Log History ──────────────────────────");
    const sortedDates = Object.keys(state.logs || {}).sort().reverse();
    sortedDates.forEach(date => {
        const dayLog = state.logs[date];
        const checkedIds = Object.keys(dayLog).filter(id => dayLog[id]);
        if (checkedIds.length === 0) return;

        lines.push(`  ${date}`);
        checkedIds.forEach(id => {
            const task = state.tasks.find(t => String(t.id) === String(id));
            lines.push(`    ✓ ${task ? task.name : `(deleted task #${id})`}`);
        });
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, `gatividhi-export-${todayKey()}.txt`);
    showExportToast("TXT exported ✓");
};

function buildTextBar(pct, width) {
    const filled = Math.round((pct / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

/* ──────────────────────────────────────────────────────────────
   EXPORT — PDF  (uses jsPDF loaded via CDN)
   ────────────────────────────────────────────────────────────── */
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

function buildAndDownloadPDF() {
    if (typeof window.jspdf === "undefined") {
        showExportToast("PDF engine not ready — try again");
        return;
    }
    const { jsPDF } = window.jspdf;

    const W = doc.internal.pageSize.getWidth();
    const MARGIN = 18;
    const COL = W - MARGIN * 2;
    let y = 20;

    const accent = [59, 130, 246];   // blue
    const success = [16, 185, 129];  // green
    const dimGrey = [120, 130, 150];
    const dark = [20, 24, 32];

    /* header band */
    doc.setFillColor(...accent);
    doc.rect(0, 0, W, 28, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text("Gatividhi Tracker", MARGIN, 13);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("by Toolify", MARGIN, 19);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Exported: ${new Date().toLocaleString("en-IN")}`, W - MARGIN, 22, { align: "right" });

    y = 36;

    /* summary row */
    const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();
    const totalDone = Object.values(state.logs || {}).reduce((acc, day) => {
        return acc + Object.values(day).filter(Boolean).length;
    }, 0);

    const boxes = [
        { label: "Total Tasks", val: state.tasks.length },
        { label: "Months Active", val: months.length },
        { label: "Total Check-ins", val: totalDone }
    ];

    const bw = (COL - 8) / 3;
    boxes.forEach((box, i) => {
        const bx = MARGIN + i * (bw + 4);
        doc.setFillColor(240, 244, 252);
        doc.roundedRect(bx, y, bw, 18, 3, 3, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...accent);
        doc.text(String(box.val), bx + bw / 2, y + 9, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...dimGrey);
        doc.text(box.label.toUpperCase(), bx + bw / 2, y + 14.5, { align: "center" });
    });

    y += 26;

    /* monthly breakdown */
    months.forEach(month => {
        const tasks = state.tasks.filter(t => t.month === month);

        /* month header */
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(...accent);
        doc.text(month, MARGIN, y);
        doc.setDrawColor(...accent);
        doc.setLineWidth(0.4);
        doc.line(MARGIN + 22, y - 1, MARGIN + COL, y - 1);
        y += 6;

        tasks.forEach(task => {
            if (y > 270) { doc.addPage(); y = 20; }

            const done = countTaskChecksInMonth(task.id, month);
            const pct = task.target > 0 ? Math.min(100, Math.round((done / task.target) * 100)) : 0;

            /* task name */
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.setTextColor(...dark);
            doc.text(task.name, MARGIN, y);

            /* score */
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(...dimGrey);
            doc.text(`${done}/${task.target} days  •  ${pct}%`, W - MARGIN, y, { align: "right" });
            y += 4;

            /* progress bar track */
            doc.setFillColor(220, 226, 236);
            doc.roundedRect(MARGIN, y, COL, 3.5, 1.5, 1.5, "F");
            /* progress bar fill */
            if (pct > 0) {
                doc.setFillColor(...success);
                doc.roundedRect(MARGIN, y, COL * (pct / 100), 3.5, 1.5, 1.5, "F");
            }
            y += 8;
        });

        y += 4;
    });

    /* log section */
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...accent);
    doc.text("Check-in Log", MARGIN, y);
    doc.setDrawColor(...accent);
    doc.line(MARGIN + 28, y - 1, MARGIN + COL, y - 1);
    y += 7;

    const sortedDates = Object.keys(state.logs || {}).sort().reverse().slice(0, 60);
    sortedDates.forEach(date => {
        const dayLog = state.logs[date];
        const checkedIds = Object.keys(dayLog).filter(id => dayLog[id]);
        if (checkedIds.length === 0) return;

        if (y > 275) { doc.addPage(); y = 20; }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...dark);
        doc.text(date, MARGIN, y);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(...dimGrey);
        const names = checkedIds.map(id => {
            const t = state.tasks.find(t => String(t.id) === String(id));
            return t ? t.name : "(deleted)";
        }).join("  •  ");
        doc.text(names, MARGIN + 22, y);
        y += 5.5;
    });

    /* footer on every page */
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...dimGrey);
        doc.text(`Page ${p} of ${pageCount}  —  Gatividhi Tracker by Toolify`, W / 2, 292, { align: "center" });
    }

    doc.save(`gatividhi-report-${todayKey()}.pdf`);
    showExportToast("PDF exported ✓");
}

/* ──────────────────────────────────────────────────────────────
   IMPORT — JSON
   ────────────────────────────────────────────────────────────── */
window.importJSON = function () {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";

    fileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            /* support both raw state and wrapped export */
            const incoming = parsed.data || parsed;

            if (!incoming.tasks || !Array.isArray(incoming.tasks)) {
                showExportToast("Invalid file — missing tasks ✗", true);
                return;
            }

            const normalized = normalizeState(incoming);

            const confirm = window.confirm(
                `Import ${normalized.tasks.length} tasks and their logs?\n\nThis will MERGE with your current data (existing tasks kept, new ones added).`
            );

            if (!confirm) return;

            /* MERGE strategy: keep existing tasks, add new ones */
            const existingIds = new Set(state.tasks.map(t => String(t.id)));
            const newTasks = normalized.tasks.filter(t => !existingIds.has(String(t.id)));
            state.tasks = [...state.tasks, ...newTasks];

            /* merge logs */
            Object.keys(normalized.logs || {}).forEach(date => {
                if (!state.logs[date]) state.logs[date] = {};
                Object.assign(state.logs[date], normalized.logs[date]);
            });

            state.meta.updatedAt = Date.now();

            saveLocal();
            scheduleSync("import-json");
            renderTasks();
            if (isStatsVisible()) renderStats();

            showExportToast(`Imported ${newTasks.length} new tasks ✓`);
        } catch (err) {
            console.error("Import error:", err);
            showExportToast("Parse error — invalid JSON ✗", true);
        }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    setTimeout(() => fileInput.remove(), 5000);
};

/* ──────────────────────────────────────────────────────────────
   IMPORT — CSV  (exported separately for spreadsheet compat)
   ────────────────────────────────────────────────────────────── */
window.exportCSV = function () {
    const rows = [["Month", "Task Name", "Target Days", "Days Completed", "Progress %", "Created At"]];

    state.tasks.forEach(task => {
        const done = countTaskChecksInMonth(task.id, task.month);
        const pct = task.target > 0 ? Math.round((done / task.target) * 100) : 0;
        rows.push([
            task.month,
            `"${task.name.replace(/"/g, '""')}"`,
            task.target,
            done,
            pct,
            new Date(task.createdAt).toLocaleDateString("en-IN")
        ]);
    });

    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `gatividhi-tasks-${todayKey()}.csv`);
    showExportToast("CSV exported ✓");
};

/* ──────────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────────── */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 1000);
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

/* ──────────────────────────────────────────────────────────────
   MODAL OPEN/CLOSE
   ────────────────────────────────────────────────────────────── */
window.openExportModal = function () {
    const m = document.getElementById("exportImportModal");
    if (m) m.classList.add("show");
};

window.closeExportModal = function () {
    const m = document.getElementById("exportImportModal");
    if (m) m.classList.remove("show");
};
