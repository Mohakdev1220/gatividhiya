"use strict";

/* ===============================
   Gatividhi Tracker — PRO BUILD (FIXED)
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

/* ---------- 3) Auth Ready ---------- */
let authReadyResolve;
let authReadyResolved = false;

const authReady = new Promise((resolve) => {
    authReadyResolve = resolve;
});
// Auth ready fallback (VERY IMPORTANT)
setTimeout(() => {
    if (!authReadyResolved) {
        authReadyResolved = true;
        authReadyResolve();
    }
}, 2000);
/* ---------- 4) Local State ---------- */
const STORAGE_KEY = "gatividhi_v1";

function getDefaultState() {
    return {
        tasks: [],
        logs: {},
        meta: { updatedAt: 0 }
    };
}

function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : getDefaultState();
    } catch {
        return getDefaultState();
    }
}

let state = loadLocal();

function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- 5) Helpers ---------- */
function now() { return Date.now(); }
function getUser() { return auth.currentUser; }

/* ---------- 6) CLOUD SYNC ---------- */
async function syncToCloud(reason = "update") {
    await authReady;

    const user = getUser();
    if (!user) return;

    try {
        const payload = {
            uid: user.uid,
            email: user.email || null,
            name: user.displayName || null,
            photo: user.photoURL || null,
            data: state,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            reason
        };

        await db.collection("users").doc(user.uid).set(payload, { merge: true });

        console.log("✅ Saved");

    } catch (e) {
        console.error("❌ Firestore error:", e.code, e.message);
    }
}

/* ---------- 7) LOAD FROM CLOUD ---------- */
async function loadFromCloud(user) {
    try {
        const doc = await db.collection("users").doc(user.uid).get();

        if (doc.exists && doc.data()?.data) {
            const cloud = doc.data().data;

            // SAFE MERGE (avoid corruption)
            if (typeof cloud === "object") {
                state = {
                    ...getDefaultState(),
                    ...cloud
                };
                saveLocal();
               renderTasks();
            }

            console.log("☁️ Loaded from cloud");
        } else {
            await syncToCloud("first-save");
        }

    } catch (e) {
        console.error("Load error:", e);
    }
};

/* ---------- 8) REALTIME SYNC ---------- */
let unsubscribe = null;

function listenToCloud(user) {
    if (unsubscribe) unsubscribe();

    unsubscribe = db.collection("users")
        .doc(user.uid)
        .onSnapshot((doc) => {
            if (!doc.exists) return;

            const cloud = doc.data()?.data;
            if (!cloud) return;

            // prevent unnecessary overwrite
            if (JSON.stringify(cloud) === JSON.stringify(state)) return;

            state = {
                ...getDefaultState(),
                ...cloud
            };

            saveLocal();
           renderTasks();
            console.log("🔄 Synced from cloud");
    });
}

/* ---------- 9) AUTH ---------- */
auth.onAuthStateChanged(async (user) => {

    if (!authReadyResolved) {
        authReadyResolved = true;
        authReadyResolve();
    }

    console.log("AUTH:", user);

    if (user) {
        try {
            await user.reload();
        } catch {
            console.warn("reload failed");
        }

        console.log("EMAIL:", user.email);

        await loadFromCloud(user);
        listenToCloud(user);

    } else {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
    }
};

/* ---------- 10) LOGIN ---------- */
window.handleLogin = async function () {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope("email");
        provider.addScope("profile");

        const res = await auth.signInWithPopup(provider);

        if (res.user) {
            await res.user.reload();
        }

        console.log("LOGIN SUCCESS:", res.user);

    } catch (e) {
        console.error("Login error:", e);
    }
};

/* ---------- 11) LOGOUT ---------- */
window.handleLogout = async function () {
    await auth.signOut();
};

/* ---------- 12) ADD TASK ---------- */
window.addTask = function () {
    const name = document.getElementById("tName").value;
    if (!name) return alert("Enter name");

    state.tasks.push({
        id: now(),
        name
    });

    state.meta.updatedAt = now();

    saveLocal();
   renderTasks(); 
    syncToCloud("add-task");
};

/* ---------- 13) TOGGLE TASK ---------- */
window.toggleTask = function (id) {
    const today = new Date().toISOString().slice(0, 10);

    if (!state.logs) state.logs = {};
    if (!state.logs[today]) state.logs[today] = {};

    state.logs[today][id] = !state.logs[today][id];

    state.meta.updatedAt = now();

    saveLocal();
   renderTasks(); 
    syncToCloud("toggle-task");
};


window.switchView = function(view) {
    console.log("Switching view:", view);
    // simple placeholder (baad me full logic daal)
};

window.toggleTheme = function() {
    console.log("Theme toggled");
    // optional: state.theme = ...
};

function startClock() {
    setInterval(() => {
        const timeEl = document.getElementById("liveTime");
        const dateEl = document.getElementById("liveDate");

        if (!timeEl || !dateEl) return;

        const now = new Date();

        timeEl.textContent = now.toLocaleTimeString();
        dateEl.textContent = now.toDateString();

    }, 1000);
}
function renderTasks() {
    const list = document.getElementById("taskList");
    if (!list) return;

    list.innerHTML = "";

    const today = new Date().toISOString().slice(0, 10);

    state.tasks.forEach(task => {
        const checked = state.logs?.[today]?.[task.id];

        const div = document.createElement("div");
        div.innerHTML = `
            <label>
                <input type="checkbox"
                    ${checked ? "checked" : ""}
                    onchange="toggleTask(${task.id})">
                ${task.name}
            </label>
        `;

        list.appendChild(div);
    });
}

                        document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 App Ready");
    startClock();
    renderTasks(); // 🔥 VERY IMPORTANT
});
