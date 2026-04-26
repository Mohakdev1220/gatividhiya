"use strict";

/* =========================================================
   Gatividhi Tracker — Main JS
   ========================================================= */

/* ---------- 0) Prevent duplicate initialization ---------- */
if (window.__gatividhiTrackerLoaded) {
    console.warn("Gatividhi Tracker JS already loaded. Duplicate script ignored.");
} else {
    window.__gatividhiTrackerLoaded = true;
}

/* ---------- 1) Firebase Configuration ---------- */
const firebaseConfig = {
    apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
    authDomain: "gatividhiya.firebaseapp.com",
    databaseURL: "https://gatividhiya-default-rtdb.firebaseio.com",
    projectId: "gatividhiya",
    storageBucket: "gatividhiya.firebasestorage.app",
    messagingSenderId: "305825266364",
    appId: "1:305825266364:web:b4e7b0921644f88b632eb9"
};

/* ---------- 2) Firebase Init (safe) ---------- */
if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK not found. Check your script tags.");
}

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const firestore = firebase.firestore();

/* ---------- 3) App Storage ---------- */
const STORAGE_KEY = "toolify_gatividhi_v11";
const LEGACY_STORAGE_KEY = "toolify_gatividhi_v10";

const DEFAULT_STATE = {
    version: 1,
    theme: "dark",
    tasks: [],
    logs: {},
    meta: {
        updatedAt: 0,
        updatedBy: "local"
    }
};

let state = loadState();
let unsubscribeCloud = null;
let saveTimer = null;
let activeEditTaskId = null;
let activeDeleteTaskId = null;
let lineChart = null;
let pieChart = null;
let appReady = false;

/* ---------- 4) Small Helpers ---------- */
function el(id) {
    return document.getElementById(id);
}

function nowMs() {
    return Date.now();
}

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

function safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTask(task) {
    const id = Number(task?.id || nowMs() + Math.floor(Math.random() * 100000));
    const name = String(task?.name || "").trim();
    const target = Number.isFinite(Number(task?.target)) ? Math.max(1, Math.floor(Number(task.target))) : 30;
    const month = String(task?.month || todayKey().slice(0, 7));
    const createdAt = Number(task?.createdAt || nowMs());
    const updatedAt = Number(task?.updatedAt || createdAt);

    return {
        id,
        name,
        target,
        month,
        createdAt,
        updatedAt
    };
}

function normalizeState(input) {
    const base = deepClone(DEFAULT_STATE);
    const source = isObject(input) ? input : {};

    base.theme = source.theme === "light" ? "light" : "dark";
    base.tasks = Array.isArray(source.tasks) ? source.tasks.map(normalizeTask).filter(t => t.name.length > 0) : [];
    base.logs = isObject(source.logs) ? source.logs : {};
    base.meta = isObject(source.meta) ? {
        updatedAt: Number(source.meta.updatedAt || 0),
        updatedBy: String(source.meta.updatedBy || "local")
    } : deepClone(DEFAULT_STATE.meta);

    return base;
}

function loadState() {
    const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem(LEGACY_STORAGE_KEY);

    const parsed = raw ? safeJsonParse(raw) : null;
    const normalized = normalizeState(parsed);

    if (!localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }

    return normalized;
}

function persistLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getCurrentUserId() {
    return auth.currentUser ? auth.currentUser.uid : null;
}

function cloudDocRef(uid) {
    return firestore.collection("users").doc(uid);
}

function getRemoteUpdatedAtMillis(docData) {
    const topLevel = docData?.updatedAt;
    if (topLevel && typeof topLevel.toMillis === "function") {
        return topLevel.toMillis();
    }
    if (typeof docData?.gatividhi_data?.meta?.updatedAt === "number") {
        return docData.gatividhi_data.meta.updatedAt;
    }
    return 0;
}

function getLocalUpdatedAtMillis() {
    return Number(state?.meta?.updatedAt || 0);
}

function setThemeOnDocument() {
    document.documentElement.setAttribute("data-theme", state.theme === "light" ? "light" : "dark");
    document.body.setAttribute("data-theme", state.theme === "light" ? "light" : "dark");
}

function setButtonHandlersOnce() {
    const saveEditBtn = el("saveEditBtn");
    const confirmDelBtn = el("confirmDelBtn");
    const editModal = el("editModal");
    const deleteModal = el("deleteModal");

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
            if (e.target === editModal) closeModals();
        });
    }

    if (deleteModal && !deleteModal.dataset.bound) {
        deleteModal.dataset.bound = "1";
        deleteModal.addEventListener("click", (e) => {
            if (e.target === deleteModal) closeModals();
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModals();
    });
}

function ensureDateInputDefault() {
    const cal = el("calInput");
    if (cal && !cal.value) {
        cal.value = todayKey();
    }
}

function startClock() {
    if (window.__gatividhiClockStarted) return;
    window.__gatividhiClockStarted = true;

    const tick = () => {
        const timeEl = el("liveTime");
        const dateEl = el("liveDate");
        const now = new Date();

        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString("en-US", {
                hour12: true,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
        }

        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString("en-US", {
                weekday: "long",
                day: "numeric",
                month: "short"
            }).toUpperCase();
        }
    };

    tick();
    setInterval(tick, 1000);
}

function setAuthUI(user) {
    const loginBtn = el("login-btn");
    const userInfo = el("user-info");
    const userPic = el("user-pic");
    const userName = el("user-name");

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

function renderAll() {
    setThemeOnDocument();
    ensureDateInputDefault();
    refreshUI();

    const statsView = el("statsView");
    if (statsView && statsView.style.display === "block") {
        renderStats();
    }
}

function scheduleSave(reason = "mutation") {
    persistLocalState();

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void syncToCloud(reason);
    }, 350);
}

async function syncToCloud(reason = "mutation") {
    const uid = getCurrentUserId();
    if (!uid) return;

    try {
        const payload = {
            gatividhi_data: deepClone(state),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: uid,
            clientId: getClientId(),
            reason
        };

        await cloudDocRef(uid).set(payload, { merge: true });
    } catch (error) {
        console.error("Cloud save failed:", error);
    }
}

function getClientId() {
    const KEY = "toolify_gatividhi_client_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
        id = `client_${Math.random().toString(36).slice(2)}_${Date.now()}`;
        localStorage.setItem(KEY, id);
    }
    return id;
}

function applyRemoteState(remoteState, remoteDocMeta = {}) {
    const normalized = normalizeState(remoteState);
    const remoteMillis = getRemoteUpdatedAtMillis(remoteDocMeta) || Number(normalized.meta.updatedAt || 0);
    const localMillis = getLocalUpdatedAtMillis();

    if (remoteMillis <= localMillis) {
        return false;
    }

    state = normalized;
    state.meta.updatedAt = remoteMillis;
    state.meta.updatedBy = String(remoteDocMeta?.updatedBy || "cloud");

    persistLocalState();
    setThemeOnDocument();
    renderAll();
    return true;
}

async function seedCloudIfNeeded() {
    const uid = getCurrentUserId();
    if (!uid) return;

    try {
        const ref = cloudDocRef(uid);
        const snap = await ref.get();

        if (!snap.exists || !snap.data()?.gatividhi_data) {
            await syncToCloud("seed");
            return;
        }

        const remoteDoc = snap.data();
        const remoteState = remoteDoc.gatividhi_data;
        const remoteMillis = getRemoteUpdatedAtMillis(remoteDoc);
        const localMillis = getLocalUpdatedAtMillis();

        if (localMillis > remoteMillis) {
            await syncToCloud("local-newer");
        } else {
            applyRemoteState(remoteState, remoteDoc);
        }
    } catch (error) {
        console.error("Seed/check sync failed:", error);
    }
}

function setupCloudListener(user) {
    if (unsubscribeCloud) {
        unsubscribeCloud();
        unsubscribeCloud = null;
    }

    if (!user) return;

    const ref = cloudDocRef(user.uid);

    unsubscribeCloud = ref.onSnapshot(
        (doc) => {
            if (!doc.exists) {
                void syncToCloud("create-doc");
                return;
            }

            const data = doc.data() || {};
            const remoteState = data.gatividhi_data;

            if (!remoteState) {
                void syncToCloud("repair-missing-state");
                return;
            }

            const applied = applyRemoteState(remoteState, data);

            if (!applied && getLocalUpdatedAtMillis() > getRemoteUpdatedAtMillis(data)) {
                void syncToCloud("local-newer-after-listen");
            }
        },
        (error) => {
            console.error("Firestore snapshot error:", error);
        }
    );
}

/* ---------- 5) Auth ---------- */
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
    console.warn("Auth persistence warning:", e);
});

auth.onAuthStateChanged(async (user) => {
    setAuthUI(user);

    if (user) {
        setupCloudListener(user);

        const cloudReadyTask = seedCloudIfNeeded();
        await cloudReadyTask;

        renderAll();
    } else {
        if (unsubscribeCloud) {
            unsubscribeCloud();
            unsubscribeCloud = null;
        }

        state = loadState();
        setThemeOnDocument();
        renderAll();
    }
});

/* ---------- 6) Public Functions used by HTML ---------- */
window.handleLogin = async function handleLogin() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
    } catch (error) {
        console.error("Login failed:", error);
        alert("Login failed: " + (error?.message || "Unknown error"));
    }
};

window.handleLogout = async function handleLogout() {
    try {
        await auth.signOut();
    } catch (error) {
        console.error("Logout failed:", error);
        alert("Logout failed: " + (error?.message || "Unknown error"));
    }
};

window.toggleTheme = function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    state.meta.updatedAt = nowMs();
    state.meta.updatedBy = getCurrentUserId() || "local";
    setThemeOnDocument();
    scheduleSave("theme-toggle");
};

window.switchView = function switchView(view) {
    const trackTab = el("tab-track");
    const statsTab = el("tab-stats");
    const trackView = el("trackView");
    const statsView = el("statsView");

    if (!trackTab || !statsTab || !trackView || !statsView) return;

    trackTab.classList.toggle("active", view === "track");
    statsTab.classList.toggle("active", view === "stats");

    trackView.style.display = view === "track" ? "block" : "none";
    statsView.style.display = view === "stats" ? "block" : "none";

    if (view === "stats") {
        renderStats();
    }
};

window.quickAdd = function quickAdd(name) {
    const input = el("tName");
    if (!input) return;
    input.value = name;
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
};

window.clearInput = function clearInput(id) {
    const input = el(id);
    if (!input) return;
    input.value = "";
    input.focus();
};

window.addTask = function addTask() {
    const nameEl = el("tName");
    const targetEl = el("tTarget");
    const calEl = el("calInput");

    if (!nameEl || !targetEl || !calEl) return;

    const name = String(nameEl.value || "").trim();
    const targetRaw = Number(targetEl.value);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : 30;
    const month = monthKeyFromDateKey(calEl.value || todayKey());

    if (!name) {
        alert("Activity name required.");
        nameEl.focus();
        return;
    }

    const task = normalizeTask({
        id: nowMs(),
        name,
        target,
        month,
        createdAt: nowMs(),
        updatedAt: nowMs()
    });

    state.tasks.push(task);
    state.meta.updatedAt = nowMs();
    state.meta.updatedBy = getCurrentUserId() || "local";

    nameEl.value = "";
    targetEl.value = "";

    scheduleSave("add-task");
    refreshUI();
    if (el("statsView")?.style.display === "block") renderStats();
};

window.toggleTask = function toggleTask(id) {
    const calEl = el("calInput");
    if (!calEl) return;

    const date = calEl.value || todayKey();
    if (!state.logs[date]) state.logs[date] = {};

    state.logs[date][id] = !state.logs[date][id];
    state.meta.updatedAt = nowMs();
    state.meta.updatedBy = getCurrentUserId() || "local";

    scheduleSave("toggle-task");
    refreshUI();
    if (el("statsView")?.style.display === "block") renderStats();
};

window.openEditModal = function openEditModal(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    activeEditTaskId = id;

    const editName = el("editName");
    const editTarget = el("editTarget");
    const editModal = el("editModal");

    if (editName) editName.value = task.name || "";
    if (editTarget) editTarget.value = String(task.target || 30);
    if (editModal) editModal.classList.add("show");
};

window.openDeleteModal = function openDeleteModal(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    activeDeleteTaskId = id;

    const deleteModal = el("deleteModal");
    if (deleteModal) deleteModal.classList.add("show");
};

window.closeModals = function closeModals() {
    const overlays = document.querySelectorAll(".modal-overlay");
    overlays.forEach((m) => m.classList.remove("show"));
    activeEditTaskId = null;
    activeDeleteTaskId = null;
};

function purgeTaskFromLogs(taskId) {
    Object.keys(state.logs).forEach((dateKey) => {
        const day = state.logs[dateKey];
        if (!isObject(day)) return;

        if (taskId in day) {
            delete day[taskId];
        }

        if (Object.keys(day).length === 0) {
            delete state.logs[dateKey];
        }
    });
}

function handleSaveEdit() {
    if (activeEditTaskId == null) return;

    const task = state.tasks.find(t => t.id === activeEditTaskId);
    if (!task) {
        closeModals();
        return;
    }

    const editName = el("editName");
    const editTarget = el("editTarget");

    const name = String(editName?.value || "").trim();
    const targetRaw = Number(editTarget?.value);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : task.target;

    if (!name) {
        alert("Activity name cannot be empty.");
        return;
    }

    task.name = name;
    task.target = target;
    task.updatedAt = nowMs();

    state.meta.updatedAt = nowMs();
    state.meta.updatedBy = getCurrentUserId() || "local";

    scheduleSave("edit-task");
    refreshUI();
    if (el("statsView")?.style.display === "block") renderStats();
    closeModals();
}

function handleConfirmDelete() {
    if (activeDeleteTaskId == null) return;

    const id = activeDeleteTaskId;
    state.tasks = state.tasks.filter(t => t.id !== id);
    purgeTaskFromLogs(id);

    state.meta.updatedAt = nowMs();
    state.meta.updatedBy = getCurrentUserId() || "local";

    scheduleSave("delete-task");
    refreshUI();
    if (el("statsView")?.style.display === "block") renderStats();
    closeModals();
}

window.refreshUI = function refreshUI() {
    const calEl = el("calInput");
    const list = el("taskList");
    if (!calEl || !list) return;

    const date = calEl.value || todayKey();
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
};

function countTaskChecksInMonth(taskId, month) {
    let total = 0;
    Object.keys(state.logs).forEach((dateKey) => {
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

window.changeGraphRange = function changeGraphRange(delta) {
    if (typeof state.graphOffset !== "number") state.graphOffset = 0;
    state.graphOffset += delta * 7;
    renderStats();
};

window.renderStats = function renderStats() {
    const canvasLine = el("lineChart");
    const canvasPie = el("pieChart");
    const rangeLabel = el("rangeLabel");
    const monthList = el("monthList");

    if (!canvasLine || !canvasPie) return;

    if (typeof Chart === "undefined") {
        console.warn("Chart.js not loaded.");
        return;
    }

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
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });

    const dateKey = el("calInput")?.value || todayKey();
    const month = monthKeyFromDateKey(dateKey);
    const monthTasks = getTasksForMonth(month);
    const doneCount = monthTasks.filter(task => Boolean(state.logs?.[dateKey]?.[task.id])).length;
    const pendingCount = Math.max(0, monthTasks.length - doneCount);

    pieChart = new Chart(canvasPie.getContext("2d"), {
        type: "doughnut",
        data: {
            labels: ["Done", "Pending"],
            datasets: [{
                data: [doneCount, pendingCount]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: {
                legend: {
                    position: "bottom"
                }
            }
        }
    });

    if (monthList) {
        const months = [...new Set(state.tasks.map(t => t.month))].sort().reverse();
        const currentMonthTasks = getTasksForMonth(month);

        const monthCards = months.map((m) => {
            const tasks = getTasksForMonth(m);
            const completed = tasks.reduce((sum, task) => sum + countTaskChecksInMonth(task.id, m), 0);
            const target = tasks.reduce((sum, task) => sum + Number(task.target || 0), 0);

            return `
                <div class="card" style="margin-top:15px;">
                    <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center;">
                        <div>
                            <div style="font-weight:800; font-size:1rem;">${escapeHtml(m)}</div>
                            <div style="color:var(--text-dim); font-size:0.85rem;">${tasks.length} activities</div>
                        </div>
                        <div style="font-weight:800; color:var(--accent);">${completed}/${target}</div>
                    </div>
                </div>
            `;
        }).join("");

        monthList.innerHTML = `
            <div class="card">
                <div style="font-weight:800; font-size:1rem; margin-bottom:8px;">Monthly Summary</div>
                <div style="color:var(--text-dim); font-size:0.9rem;">
                    ${currentMonthTasks.length} activities in the selected month.
                </div>
            </div>
            ${monthCards || ""}
        `;
    }
};

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* ---------- 7) Public init ---------- */
function initApp() {
    if (appReady) return;
    appReady = true;

    setThemeOnDocument();
    ensureDateInputDefault();
    setButtonHandlersOnce();
    startClock();

    const calEl = el("calInput");
    if (calEl && !calEl.dataset.bound) {
        calEl.dataset.bound = "1";
        calEl.addEventListener("change", () => {
            refreshUI();
            if (el("statsView")?.style.display === "block") renderStats();
        });
    }

    const loginBtn = el("login-btn");
    const logoutBtn = el("logout-btn");
    if (loginBtn && !loginBtn.dataset.bound) {
        loginBtn.dataset.bound = "1";
        loginBtn.addEventListener("click", window.handleLogin);
    }
    if (logoutBtn && !logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "1";
        logoutBtn.addEventListener("click", window.handleLogout);
    }

    refreshUI();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

/* ---------- 8) Safety sync on unload ---------- */
window.addEventListener("beforeunload", () => {
    persistLocalState();
});
