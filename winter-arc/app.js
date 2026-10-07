/* =========================================================
   WINTER ARC — app.js (v2, multi-friend)
   Firebase Auth + Firestore
   Pages: dashboard.html, friend.html
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, getDocs, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";


/* =========================================================
   1. CONFIG
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
  authDomain: "gatividhiya.firebaseapp.com",
  databaseURL: "https://gatividhiya-default-rtdb.firebaseio.com",
  projectId: "gatividhiya",
  storageBucket: "gatividhiya.firebasestorage.app",
  messagingSenderId: "305825266364",
  appId: "1:305825266364:web:b4e7b0921644f88b632eb9",
  measurementId: "G-VY9CXGMPKZ"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const TOTAL_DAYS = 90;

// Every account picks its own start date (profile.startDate).
// LEGACY_START is only used once, to migrate accounts that already had data
// from before start dates existed.
const LEGACY_START = "2026-10-05";

// Maximum friends per account. Each friend = 3 live listeners.
const MAX_FRIENDS = 10;

const DEFAULT_ACTIVITIES = [
  { id: "exercise", name: "Exercise", target: "30 min", order: 1 },
  { id: "study", name: "Study", target: "1 hour", order: 2 },
  { id: "water", name: "Drink water", target: "5 litres", order: 3 }
];


/* =========================================================
   2. STATE
   ========================================================= */

let currentUser = null;
let currentProfile = null;

let activities = [];
let dailyData = {};

// friends[uid] = { id, profile, activities, days, unsubs: [] }
const friends = {};

let selectedDate = "";             // set in initDashboard (helpers aren't defined yet here)
let editingActivityId = null;
let deletingActivityId = null;
let pendingDayChanges = null;        // staged edits inside the day editor
let viewFriendId = "all";            // friend page: uid or "all"
let friendDayTarget = null;          // friend page: {uid, dateKey}
let requestCount = 0;

let unsubProfile = null;
let unsubActivities = null;
let unsubDays = null;
let unsubRequests = null;
let clockTimer = null;
let started = false;
let daysLoaded = false;
let dashboardReady = false;
let startPrompted = false;
let mustSetStart = false;


/* =========================================================
   3. HELPERS
   ========================================================= */

const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const byId = (id) => document.getElementById(id);

const pageName = location.pathname.split("/").pop().toLowerCase() || "index.html";
const isDashboardPage = pageName === "dashboard.html";
const isFriendPage = pageName === "friend.html";

const pad = (n) => String(n).padStart(2, "0");
const dateToKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
function todayKey() { return dateToKey(new Date()); }
function addDays(key, n) { const d = keyToDate(key); d.setDate(d.getDate() + n); return dateToKey(d); }
function dayDiff(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 86400000); }

const arcEnd = (start) => addDays(start, TOTAL_DAYS - 1);
function arcDates(start) {
  return start ? Array.from({ length: TOTAL_DAYS }, (_, i) => addDays(start, i)) : [];
}

function fmt(key, opts) { return keyToDate(key).toLocaleDateString(undefined, opts); }
const longDate = (k) => fmt(k, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

function esc(v = "") {
  return String(v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setText(id, v) { const e = byId(id); if (e) e.textContent = v ?? ""; }
function setWidth(id, pct) { const e = byId(id); if (e) e.style.width = `${pct}%`; }

// Inline SVG avatar so we never depend on an external placeholder service.
function initialAvatar(name = "?") {
  const letter = esc((name.trim()[0] || "?").toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#edf1ff"/><text x="50%" y="55%" font-family="Arial" font-size="44" font-weight="700" fill="#315bea" text-anchor="middle" dominant-baseline="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const nameOf = (p) => p?.displayName || p?.username || "Friend";
const avatarOf = (p) => p?.photoURL || initialAvatar(nameOf(p));
function setImg(el, p) {
  if (!el) return;
  el.referrerPolicy = "no-referrer";
  el.onerror = () => { el.onerror = null; el.src = initialAvatar(nameOf(p)); };
  el.src = avatarOf(p);
  el.alt = nameOf(p);
}

function showToast(title, message, type = "info") {
  let box = byId("toastContainer");
  if (!box) {
    box = document.createElement("div");
    box.id = "toastContainer";
    box.className = "toast-container";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-icon">${type === "success" ? "✓" : type === "error" ? "!" : "i"}</div>
    <div class="toast-content"><strong>${esc(title)}</strong><span>${esc(message)}</span></div>`;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function openModal(id) {
  const m = byId(id);
  if (!m) return;
  m.hidden = false;
  document.body.classList.add("no-scroll");
}
function closeModal(id) {
  if (id === "startModal" && mustSetStart) return;   // first-time setup can't be skipped
  const m = byId(id);
  if (!m) return;
  m.hidden = true;
  if (!$$(".modal-overlay:not([hidden])").length) document.body.classList.remove("no-scroll");
  if (id === "activityModal") editingActivityId = null;
  if (id === "deleteModal") deletingActivityId = null;
  if (id === "dayModal") pendingDayChanges = null;
}

function hideLoader() {
  const l = byId("pageLoader");
  if (l) l.hidden = true;
}


/* =========================================================
   4. GENERIC PROGRESS MATH  (works for me AND any friend)
   data = { activities: [...], days: { "YYYY-MM-DD": {completed:{id:bool}} } }
   ========================================================= */

const myData = () => ({ activities, days: dailyData, start: currentProfile?.startDate || "" });

function progress(data, key) {
  const list = data.activities;
  if (!list.length) return 0;
  const done = data.days[key]?.completed || {};
  const n = list.filter((a) => done[a.id]).length;
  return Math.round((n / list.length) * 100);
}

function lastArcDay(data) {
  const t = todayKey();
  const end = arcEnd(data.start);
  return t > end ? end : t;
}

function completedDayCount(data) {
  if (!data.start) return 0;
  const last = lastArcDay(data);
  return arcDates(data.start).filter((k) => k <= last && progress(data, k) === 100).length;
}

// Streak stays alive during today (counts from yesterday if today isn't done yet).
function streak(data) {
  if (!data.start) return 0;
  let k = lastArcDay(data);
  if (k < data.start) return 0;
  if (progress(data, k) < 100) k = addDays(k, -1);
  let n = 0;
  while (k >= data.start && progress(data, k) === 100) { n++; k = addDays(k, -1); }
  return n;
}

function lastSevenDates() {
  const end = todayKey();
  return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
}

function weeklyAverage(data) {
  const d = lastSevenDates();
  return Math.round(d.reduce((s, k) => s + progress(data, k), 0) / d.length);
}

function activityConsistency(data) {
  const elapsed = data.start ? Math.max(0, dayDiff(data.start, lastArcDay(data)) + 1) : 0;
  return data.activities.map((a) => {
    let done = 0;
    for (let i = 0; i < elapsed; i++) {
      if (data.days[addDays(data.start, i)]?.completed?.[a.id]) done++;
    }
    return { ...a, percent: elapsed ? Math.round((done / elapsed) * 100) : 0 };
  });
}

function summarize(data) {
  const t = todayKey();
  return {
    today: progress(data, t),
    streak: streak(data),
    completed: completedDayCount(data),
    week: weeklyAverage(data)
  };
}


/* =========================================================
   5. AUTH + BOOT
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  bindGlobalEvents();
  setTimeout(hideLoader, 8000); // failsafe so the page can never stay stuck
});

onAuthStateChanged(auth, async (user) => {
  if (!user || started) return;
  started = true;
  currentUser = user;

  try {
    await ensureProfile(user);
    subscribeOwnProfile();

    if (isDashboardPage) await initDashboard();
    if (isFriendPage) initFriendPage();
  } catch (err) {
    console.error(err);
    showToast("Something went wrong", "Please refresh and try again.", "error");
    hideLoader();
  }
});

async function ensureProfile(user) {
  const ref = doc(db, "profiles", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    currentProfile = { id: snap.id, ...snap.data() };
    return;
  }

  const username = await uniqueUsername(user.displayName || "winteruser");
  const profile = {
    uid: user.uid,
    displayName: user.displayName || "Winter Arc User",
    username,
    email: user.email || "",
    photoURL: user.photoURL || "",
    friendIds: [],
    createdAt: serverTimestamp()
  };
  await setDoc(ref, profile);
  currentProfile = { id: user.uid, ...profile };
}

const normalizeUsername = (v) =>
  String(v || "").toLowerCase().trim().replace(/^@/, "").replace(/[^a-z0-9._-]/g, "").slice(0, 20);

async function uniqueUsername(displayName) {
  const base = normalizeUsername(displayName) || "winteruser";
  let candidate = base;
  for (let i = 0; i < 20; i++) {
    const r = await getDocs(query(collection(db, "profiles"), where("username", "==", candidate)));
    if (r.empty) return candidate;
    candidate = `${base}${Math.floor(100 + Math.random() * 900)}`;
  }
  return `${base}${Date.now().toString().slice(-5)}`;
}


/* =========================================================
   6. OWN DATA LISTENERS
   ========================================================= */

function subscribeOwnProfile() {
  unsubProfile?.();
  unsubProfile = onSnapshot(doc(db, "profiles", currentUser.uid), (snap) => {
    if (!snap.exists()) return;
    currentProfile = { id: snap.id, ...snap.data() };
    updateUserUI();
    if (dashboardReady) renderDashboard();
    syncFriends();          // keeps friend listeners in sync with friendIds
  });
}

function subscribeActivities() {
  unsubActivities?.();
  unsubActivities = onSnapshot(
    query(collection(db, "profiles", currentUser.uid, "activities"), orderBy("order")),
    (snap) => {
      activities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDashboard();
    }
  );
}

function subscribeDays() {
  unsubDays?.();
  unsubDays = onSnapshot(collection(db, "profiles", currentUser.uid, "days"), (snap) => {
    dailyData = {};
    snap.docs.forEach((d) => (dailyData[d.id] = d.data()));
    daysLoaded = true;
    renderDashboard();
  });
}

async function ensureDefaultActivities() {
  const col = collection(db, "profiles", currentUser.uid, "activities");
  if (!(await getDocs(col)).empty) return;
  await Promise.all(DEFAULT_ACTIVITIES.map((a) =>
    setDoc(doc(col, a.id), { name: a.name, target: a.target, order: a.order, createdAt: serverTimestamp() })
  ));
}


/* =========================================================
   7. FRIEND LISTENERS  (any number of friends)
   ========================================================= */

function syncFriends() {
  const ids = (currentProfile?.friendIds || []).slice(0, MAX_FRIENDS);

  // drop removed friends
  Object.keys(friends).forEach((uid) => {
    if (!ids.includes(uid)) {
      friends[uid].unsubs.forEach((u) => u());
      delete friends[uid];
    }
  });

  // add new friends
  ids.forEach((uid) => {
    if (friends[uid]) return;
    const f = { id: uid, profile: null, activities: [], days: {}, unsubs: [] };
    friends[uid] = f;

    f.unsubs.push(onSnapshot(doc(db, "profiles", uid), (s) => {
      f.profile = s.exists() ? { id: s.id, ...s.data() } : null;
      renderFriends();
    }, (e) => console.error("friend profile", e)));

    f.unsubs.push(onSnapshot(
      query(collection(db, "profiles", uid, "activities"), orderBy("order")),
      (s) => { f.activities = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderFriends(); },
      (e) => console.error("friend activities", e)
    ));

    f.unsubs.push(onSnapshot(collection(db, "profiles", uid, "days"), (s) => {
      f.days = {};
      s.docs.forEach((d) => (f.days[d.id] = d.data()));
      renderFriends();
    }, (e) => console.error("friend days", e)));
  });

  // keep the friend-page selection valid
  if (viewFriendId !== "all" && !ids.includes(viewFriendId)) viewFriendId = "all";
  renderFriends();
}

const friendList = () =>
  (currentProfile?.friendIds || []).slice(0, MAX_FRIENDS).map((id) => friends[id]).filter((f) => f?.profile);

const friendData = (f) => ({ activities: f.activities, days: f.days, start: f.profile?.startDate || "" });

function renderFriends() {
  if (isDashboardPage) renderCircle();
  if (isFriendPage) renderFriendPage();
}


/* =========================================================
   8. DASHBOARD
   ========================================================= */

async function initDashboard() {
  selectedDate = todayKey();
  renderTodayDate();
  await ensureDefaultActivities();
  subscribeActivities();
  subscribeDays();
  bindDashboardEvents();
  dashboardReady = true;
  hideLoader();
}

function renderDashboard() {
  renderTodayDate();
  checkStartDate();
  renderActivities();
  renderStats();
  renderCalendar();
  renderSelectedDay();
  renderAnalytics();
  renderCircle();
}

function updateUserUI() {
  const p = currentProfile || {};
  const name = p.displayName || currentUser?.displayName || "Winter Arc User";
  const prof = { ...p, displayName: name, photoURL: p.photoURL || currentUser?.photoURL || "" };

  setText("userDisplayName", name);
  setText("mobileUserName", name);
  setText("modalUserName", name);
  setText("modalUsername", p.username ? `@${p.username}` : "");
  setText("modalUserEmail", p.email || currentUser?.email || "");
  setText("modalStartDate", p.startDate ? longDate(p.startDate) : "Not set yet");
  ["userAvatar", "mobileUserAvatar", "modalUserAvatar"].forEach((id) => setImg(byId(id), prof));
}

function startClock() {
  const tick = () => setText("clockTime",
    new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
}

function renderTodayDate() {
  const t = todayKey();
  const start = currentProfile?.startDate;
  let label = "Set your start date";
  let range = "Pick a start date to begin your 90 days";

  if (start) {
    const end = arcEnd(start);
    const f = { month: "long", day: "numeric", year: "numeric" };
    range = `${fmt(start, f)} — ${fmt(end, f)}`;
    if (t < start) {
      const n = dayDiff(t, start);
      label = `Starts in ${n} day${n === 1 ? "" : "s"}`;
    } else if (t > end) label = "Arc complete";
    else label = `Day ${dayDiff(start, t) + 1} of ${TOTAL_DAYS}`;
  }

  setText("todayLabel", label);
  setText("currentDateLabel", longDate(t));
  setText("calendarRange", range);
}

/* ---------- start date (per user) ---------- */

function checkStartDate() {
  if (startPrompted || !currentProfile || !daysLoaded || currentProfile.startDate) return;
  startPrompted = true;

  if (Object.keys(dailyData).length) {
    // account from before start dates existed: keep its original window
    updateDoc(doc(db, "profiles", currentUser.uid), { startDate: LEGACY_START }).catch(console.error);
  } else {
    openStartModal(true);
  }
}

function openStartModal(first = false) {
  mustSetStart = first;
  byId("startDateInput").value = currentProfile?.startDate || todayKey();
  byId("startModalClose").hidden = first;
  byId("startCancelButton").hidden = first;
  setText("startModalTitle", first ? "When does your arc begin?" : "Change start date");
  openModal("startModal");
}

async function saveStartDate() {
  const v = byId("startDateInput").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return showToast("Pick a date", "Choose the day your 90 days begin.", "error");
  try {
    await updateDoc(doc(db, "profiles", currentUser.uid), { startDate: v });
    mustSetStart = false;
    closeModal("startModal");
    showToast("Start date saved", `Day 1 is ${longDate(v)}.`, "success");
  } catch (e) {
    console.error(e);
    showToast("Could not save", "Please try again.", "error");
  }
}

/* ---------- activities (today) ---------- */

function renderActivities() {
  const list = byId("activitiesList");
  if (!list) return;

  const t = todayKey();
  setText("activityDateLabel", `${longDate(t)} — tick things off as you finish them.`);

  if (!activities.length) {
    list.innerHTML = `<div class="request-empty">No activities yet. Add your first one.</div>`;
  } else {
    const done = dailyData[t]?.completed || {};
    list.innerHTML = activities.map((a) => `
      <div class="activity-item ${done[a.id] ? "completed" : ""}">
        <button type="button" class="activity-check" data-action="toggle-activity" data-id="${esc(a.id)}"
          aria-label="Toggle ${esc(a.name)}">${done[a.id] ? "✓" : ""}</button>
        <div class="activity-main">
          <span class="activity-name">${esc(a.name)}</span>
          <span class="activity-target">Target: ${esc(a.target)}</span>
        </div>
        <div class="activity-actions">
          <button type="button" class="activity-action" data-action="edit-activity" data-id="${esc(a.id)}" title="Edit" aria-label="Edit activity">✎</button>
          <button type="button" class="activity-action delete" data-action="delete-activity" data-id="${esc(a.id)}" title="Delete" aria-label="Delete activity">×</button>
        </div>
      </div>`).join("");
  }

  const pct = progress(myData(), t);
  const n = activities.filter((a) => dailyData[t]?.completed?.[a.id]).length;
  setText("activityProgressText", `${pct}%`);
  setWidth("activityProgressBar", pct);
  setText("heroProgressPercent", `${pct}%`);
  setWidth("heroProgressBar", pct);
  setText("heroCompletedText", `${n} of ${activities.length} completed`);
}

async function toggleActivity(activityId, key = todayKey()) {
  if (key > todayKey()) return showToast("Not yet", "You can't complete future days.", "error");
  const cur = dailyData[key]?.completed || {};
  try {
    await setDoc(doc(db, "profiles", currentUser.uid, "days", key),
      { completed: { ...cur, [activityId]: !cur[activityId] }, updatedAt: serverTimestamp() },
      { merge: true });
  } catch (e) {
    console.error(e);
    showToast("Could not save", "Check your connection and try again.", "error");
  }
}

function openActivityModal(id = null) {
  editingActivityId = id;
  const a = id ? activities.find((x) => x.id === id) : null;
  if (id && !a) return;
  setText("activityModalTitle", a ? "Edit Activity" : "Add Activity");
  byId("activityName").value = a?.name || "";
  byId("activityTarget").value = a?.target || "";
  openModal("activityModal");
  setTimeout(() => byId("activityName").focus(), 80);
}

async function saveActivity() {
  const name = byId("activityName").value.trim();
  const target = byId("activityTarget").value.trim();
  if (!name || !target) return showToast("Missing details", "Enter a name and a target.", "error");

  try {
    if (editingActivityId) {
      await updateDoc(doc(db, "profiles", currentUser.uid, "activities", editingActivityId), { name, target });
      showToast("Activity updated", `${name} was updated.`, "success");
    } else {
      const order = activities.length ? Math.max(...activities.map((a) => Number(a.order) || 0)) + 1 : 1;
      await addDoc(collection(db, "profiles", currentUser.uid, "activities"),
        { name, target, order, createdAt: serverTimestamp() });
      showToast("Activity added", `${name} was added.`, "success");
    }
    closeModal("activityModal");
  } catch (e) {
    console.error(e);
    showToast("Could not save", "Please try again.", "error");
  }
}

function openDeleteModal(id) {
  const a = activities.find((x) => x.id === id);
  if (!a) return;
  deletingActivityId = id;
  setText("deleteModalText", `Delete "${a.name}" from your routine? Past day records stay as they are.`);
  openModal("deleteModal");
}

async function confirmDelete() {
  if (!deletingActivityId) return closeModal("deleteModal");
  try {
    await deleteDoc(doc(db, "profiles", currentUser.uid, "activities", deletingActivityId));
    showToast("Activity removed", "It was removed from your routine.", "success");
  } catch (e) {
    console.error(e);
    showToast("Could not delete", "Please try again.", "error");
  }
  closeModal("deleteModal");
}

/* ---------- stats ---------- */

function renderStats() {
  const s = summarize(myData());
  setText("currentStreak", s.streak);
  setText("todayPercent", `${s.today}%`);
  setText("completedDays", s.completed);
  setText("overallPercent", `${Math.round((s.completed / TOTAL_DAYS) * 100)}%`);
  setText("heroStreakText", `${s.streak} day streak`);
}

/* ---------- calendar (shared builder) ---------- */

function calendarHTML(data, attr) {
  if (!data.start) return `<div class="request-empty" style="grid-column:1/-1">Start date not set yet.</div>`;
  const t = todayKey();
  const blanks = keyToDate(data.start).getDay();
  const cells = Array.from({ length: blanks }, () => `<div class="calendar-day empty"></div>`);

  arcDates(data.start).forEach((k) => {
    const p = progress(data, k);
    const cls = ["calendar-day",
      p === 100 ? "complete" : "",
      p > 0 && p < 100 ? "partial" : "",
      k === data.start ? "starting-day" : "",
      k === t ? "today" : ""].filter(Boolean).join(" ");
    const label = k === data.start ? "Starting Day" : p === 100 ? "Complete" : p > 0 ? `${p}%` : "";
    cells.push(`<button type="button" class="${cls}" ${attr}="${k}" title="${esc(longDate(k))}">
      <span class="calendar-day-number">${keyToDate(k).getDate()}</span>
      ${label ? `<span class="calendar-day-label">${esc(label)}</span>` : ""}</button>`);
  });
  return cells.join("");
}

function renderCalendar() {
  const g = byId("calendarGrid");
  if (g) g.innerHTML = calendarHTML(myData(), "data-calendar-date");
}

/* ---------- selected day + editor ---------- */

function selectDay(key) {
  selectedDate = key;
  renderSelectedDay();
  byId("selectedDayCard")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderSelectedDay() {
  const card = byId("selectedDayCard");
  if (!card) return;
  // only show once a day other than the default has been picked
  if (!card.dataset.shown) return;

  const done = dailyData[selectedDate]?.completed || {};
  setText("selectedDayTitle", longDate(selectedDate));
  setText("selectedDaySubtitle", `${progress(myData(), selectedDate)}% complete`);
  byId("selectedDayActivities").innerHTML = activities.length
    ? activities.map((a) => `
      <div class="selected-day-row">
        <div><span class="selected-day-row-name">${esc(a.name)}</span>
        <span class="selected-day-row-target">${esc(a.target)}</span></div>
        <span class="${done[a.id] ? "completed-status" : "incomplete-status"}">${done[a.id] ? "Completed" : "Not done"}</span>
      </div>`).join("")
    : `<div class="request-empty">No activities.</div>`;
}

function openDayEditor(key) {
  selectedDate = key;
  const card = byId("selectedDayCard");
  if (card) { card.hidden = false; card.dataset.shown = "1"; }
  renderSelectedDay();

  if (key > todayKey()) return showToast("Future day", "You can edit a day once it arrives.", "error");

  pendingDayChanges = { ...(dailyData[key]?.completed || {}) };
  setText("dayModalTitle", "Edit Day");
  setText("dayModalDate", longDate(key));
  renderDayEditor();
  openModal("dayModal");
}

function renderDayEditor() {
  byId("dayEditorList").innerHTML = activities.map((a) => `
    <button type="button" class="day-editor-item ${pendingDayChanges[a.id] ? "completed" : ""}"
      data-day-activity="${esc(a.id)}" style="width:100%;text-align:left;cursor:pointer">
      <span class="day-editor-check">✓</span>
      <span class="day-editor-info"><strong>${esc(a.name)}</strong><span>${esc(a.target)}</span></span>
    </button>`).join("");
}

async function saveDay() {
  if (!pendingDayChanges) return;
  try {
    await setDoc(doc(db, "profiles", currentUser.uid, "days", selectedDate),
      { completed: pendingDayChanges, updatedAt: serverTimestamp() }, { merge: true });
    showToast("Progress saved", longDate(selectedDate), "success");
    closeModal("dayModal");
  } catch (e) {
    console.error(e);
    showToast("Could not save", "Please try again.", "error");
  }
}

/* ---------- analytics (shared) ---------- */

function weeklyChartHTML(data) {
  return lastSevenDates().map((k) => {
    const p = progress(data, k);
    return `<div class="chart-bar-wrapper">
      <span class="chart-bar-value">${p}%</span>
      <div class="chart-bar" style="height:${Math.max(p, 3)}%"></div>
      <span class="chart-bar-label">${fmt(k, { weekday: "short" }).slice(0, 3)}</span></div>`;
  }).join("");
}

function consistencyHTML(data) {
  const rows = activityConsistency(data);
  if (!rows.length) return `<div class="request-empty">No activities yet.</div>`;
  return rows.map((r) => `
    <div class="activity-chart-row">
      <span class="activity-chart-name">${esc(r.name)}</span>
      <div class="activity-chart-track"><div class="activity-chart-fill" style="width:${r.percent}%"></div></div>
      <span class="activity-chart-percent">${r.percent}%</span></div>`).join("");
}

function avgConsistency(data) {
  const r = activityConsistency(data);
  return r.length ? Math.round(r.reduce((s, x) => s + x.percent, 0) / r.length) : 0;
}

function renderAnalytics() {
  const w = byId("weeklyChart");
  if (!w) return;
  const d = myData();
  w.innerHTML = weeklyChartHTML(d);
  setText("weeklyAverage", `${weeklyAverage(d)}%`);
  byId("activityChart").innerHTML = consistencyHTML(d);
  setText("activityAverage", `${avgConsistency(d)}%`);
}


/* =========================================================
   9. YOUR CIRCLE  (dashboard — ranked view of ALL friends)
   ========================================================= */

function rankedPeople() {
  const me = {
    id: currentUser.uid, isMe: true, profile: { ...currentProfile, displayName: "You" },
    ...summarize(myData())
  };
  const others = friendList().map((f) => ({
    id: f.id, isMe: false, profile: f.profile, ...summarize(friendData(f))
  }));
  return [me, ...others].sort((a, b) =>
    b.today - a.today || b.streak - a.streak || b.completed - a.completed);
}

function renderCircle() {
  const list = byId("circleList");
  if (!list || !currentProfile) return;

  const count = (currentProfile.friendIds || []).length;
  setText("circleCount", `${count}/${MAX_FRIENDS}`);
  byId("circleEmpty").hidden = count > 0;
  list.hidden = count === 0;
  byId("circleFooter").hidden = count === 0;
  if (!count) return;

  const medals = ["🥇", "🥈", "🥉"];
  list.innerHTML = rankedPeople().map((p, i) => {
    const inner = `
      <span class="circle-rank">${medals[i] || i + 1}</span>
      <img class="circle-avatar" src="${esc(avatarOf(p.profile))}" alt="" referrerpolicy="no-referrer">
      <div class="circle-info">
        <div class="circle-top"><strong>${esc(p.isMe ? "You" : nameOf(p.profile))}</strong><span>${p.today}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${p.today}%"></div></div>
        <small>🔥 ${p.streak} streak · ${p.completed} days done</small>
      </div>`;
    return p.isMe
      ? `<div class="circle-row is-me">${inner}</div>`
      : `<a class="circle-row" href="friend.html?u=${esc(p.id)}">${inner}</a>`;
  }).join("");
}


/* =========================================================
   10. FRIEND PAGE
   ========================================================= */

function initFriendPage() {
  const u = new URLSearchParams(location.search).get("u");
  if (u) viewFriendId = u;

  bindFriendPageEvents();
  subscribeRequests();
  hideLoader();
  renderFriendPage();
}

function setView(id) {
  viewFriendId = id;
  const url = new URL(location.href);
  id === "all" ? url.searchParams.delete("u") : url.searchParams.set("u", id);
  history.replaceState(null, "", url);
  renderFriendPage();
}

function renderFriendPage() {
  const tabs = byId("friendTabs");
  if (!tabs || !currentProfile) return;

  const list = friendList();
  const total = (currentProfile.friendIds || []).length;

  setText("friendCountLabel", `${total} of ${MAX_FRIENDS} friends`);

  if (viewFriendId !== "all" && !friends[viewFriendId]) viewFriendId = "all";
  if (viewFriendId === "all" && total === 1 && list.length === 1) viewFriendId = list[0].id;

  // tabs
  tabs.hidden = total === 0;
  tabs.innerHTML = (total > 1
    ? `<button type="button" class="friend-tab ${viewFriendId === "all" ? "active" : ""}" data-friend-tab="all">
         <span class="friend-tab-icon">◫</span><span>Everyone</span></button>` : "") +
    list.map((f) => `
      <button type="button" class="friend-tab ${viewFriendId === f.id ? "active" : ""}" data-friend-tab="${esc(f.id)}">
        <img src="${esc(avatarOf(f.profile))}" alt="" referrerpolicy="no-referrer">
        <span>${esc(nameOf(f.profile).split(" ")[0])}</span>
        <b>${progress(friendData(f), todayKey())}%</b>
      </button>`).join("");

  const detail = byId("friendDashboardSection");
  const compare = byId("friendCompareSection");
  detail.hidden = !(viewFriendId !== "all" && friends[viewFriendId]?.profile);
  compare.hidden = !(viewFriendId === "all" && total > 1 && list.length > 0);

  if (!detail.hidden) renderFriendDetail(friends[viewFriendId]);
  if (!compare.hidden) renderCompare(list);
}

/* ---------- compare view ---------- */

function renderCompare(list) {
  const people = rankedPeople();
  const medals = ["🥇", "🥈", "🥉"];

  byId("leaderboardList").innerHTML = people.map((p, i) => `
    <div class="leader-row ${p.isMe ? "is-me" : ""}">
      <span class="circle-rank">${medals[i] || i + 1}</span>
      <img class="circle-avatar" src="${esc(avatarOf(p.profile))}" alt="" referrerpolicy="no-referrer">
      <strong>${esc(p.isMe ? "You" : nameOf(p.profile))}</strong>
      <span class="leader-stat"><small>Today</small>${p.today}%</span>
      <span class="leader-stat"><small>Week</small>${p.week}%</span>
      <span class="leader-stat"><small>Streak</small>${p.streak}</span>
      <span class="leader-stat"><small>Done</small>${p.completed}</span>
    </div>`).join("");

  byId("compareGrid").innerHTML = list.map((f) => {
    const d = friendData(f);
    const s = summarize(d);
    return `
      <article class="dashboard-card compare-card">
        <div class="compare-head">
          <img class="friend-avatar" src="${esc(avatarOf(f.profile))}" alt="" referrerpolicy="no-referrer">
          <div><strong>${esc(nameOf(f.profile))}</strong><span>@${esc(f.profile.username || "")}</span></div>
          <b class="compare-pct">${s.today}%</b>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${s.today}%"></div></div>
        <div class="mini-bars">${lastSevenDates().map((k) => {
          const p = progress(d, k);
          return `<i title="${esc(fmt(k, { month: "short", day: "numeric" }))}: ${p}%"><u style="height:${Math.max(p, 4)}%"></u></i>`;
        }).join("")}</div>
        <div class="friend-mini-stats"><div><span>Streak</span><strong>${s.streak}</strong></div>
          <div><span>Completed</span><strong>${s.completed}</strong></div></div>
        <button type="button" class="secondary-button full-width" data-friend-tab="${esc(f.id)}">View dashboard</button>
      </article>`;
  }).join("");
}

/* ---------- single friend view ---------- */

function renderFriendDetail(f) {
  const d = friendData(f);
  const s = summarize(d);
  const t = todayKey();

  setImg(byId("friendPageAvatar"), f.profile);
  setText("friendPageName", nameOf(f.profile));
  setText("friendPageUsername", f.profile.username ? `@${f.profile.username}` : "");

  const active = Object.values(f.days[t]?.completed || {}).some(Boolean);
  byId("friendStatusDot")?.classList.toggle("online", active);
  setText("friendOnlineLabel", active ? "Active today" : "Not active yet");

  setText("friendPageStreak", s.streak);
  setText("friendPageTodayPercent", `${s.today}%`);
  setText("friendPageCompletedDays", s.completed);
  setText("friendPageOverallPercent", `${Math.round((s.completed / TOTAL_DAYS) * 100)}%`);
  setText("friendTodayDate", longDate(t));
  setText("friendDailyProgressText", `${s.today}%`);
  setWidth("friendDailyProgressBar", s.today);

  const done = f.days[t]?.completed || {};
  byId("friendActivitiesList").innerHTML = f.activities.length
    ? f.activities.map((a) => `
      <div class="friend-activity-item ${done[a.id] ? "completed" : ""}">
        <span class="friend-activity-status">${done[a.id] ? "✓" : "—"}</span>
        <div class="friend-activity-info"><strong>${esc(a.name)}</strong><span>Target: ${esc(a.target)}</span></div>
      </div>`).join("")
    : `<div class="request-empty">No activities yet.</div>`;

  byId("friendCalendarGrid").innerHTML = calendarHTML(d, "data-friend-calendar-date");
  byId("friendWeeklyChart").innerHTML = weeklyChartHTML(d);
  setText("friendWeeklyAverage", `${s.week}%`);
  byId("friendActivityChart").innerHTML = consistencyHTML(d);
  setText("friendActivityAverage", `${avgConsistency(d)}%`);
}

function openFriendDay(key) {
  const f = friends[viewFriendId];
  if (!f) return;
  const done = f.days[key]?.completed || {};
  setText("friendDayModalTitle", `${nameOf(f.profile)}'s day`);
  setText("friendDayModalDate", `${longDate(key)} · ${progress(friendData(f), key)}% complete`);
  byId("friendDayViewList").innerHTML = f.activities.map((a) => `
    <div class="day-editor-item read-only ${done[a.id] ? "completed" : ""}">
      <span class="day-editor-check">✓</span>
      <span class="day-editor-info"><strong>${esc(a.name)}</strong><span>${esc(a.target)}</span></span>
    </div>`).join("");
  openModal("friendDayModal");
}


/* =========================================================
   11. FRIEND REQUESTS
   ========================================================= */

function showSearchMessage(text, type) {
  const m = byId("friendSearchMessage");
  if (!m) return;
  m.hidden = !text;
  m.textContent = text || "";
  m.className = `friend-search-message ${type || ""}`;
}

async function sendFriendRequest(raw) {
  const username = normalizeUsername(raw);
  const btn = byId("sendFriendRequestButton");

  if (!username) return showSearchMessage("Enter a username.", "error");
  if (username === currentProfile.username) return showSearchMessage("That's your own username.", "error");
  if ((currentProfile.friendIds || []).length >= MAX_FRIENDS)
    return showSearchMessage(`You've reached the ${MAX_FRIENDS} friend limit.`, "error");

  btn && (btn.disabled = true);
  try {
    const found = await getDocs(query(collection(db, "profiles"), where("username", "==", username)));
    if (found.empty) return showSearchMessage(`No user found with @${username}.`, "error");

    const target = found.docs[0];
    if ((currentProfile.friendIds || []).includes(target.id))
      return showSearchMessage("You're already friends.", "error");

    const sent = await getDocs(query(collection(db, "friendRequests"),
      where("from", "==", currentUser.uid), where("to", "==", target.id), where("status", "==", "pending")));
    if (!sent.empty) return showSearchMessage("You already sent them a request.", "error");

    const incoming = await getDocs(query(collection(db, "friendRequests"),
      where("from", "==", target.id), where("to", "==", currentUser.uid), where("status", "==", "pending")));
    if (!incoming.empty) return showSearchMessage("They already requested you — accept it below.", "error");

    await addDoc(collection(db, "friendRequests"), {
      from: currentUser.uid, to: target.id,
      fromUsername: currentProfile.username, toUsername: target.data().username,
      fromName: currentProfile.displayName, fromPhoto: currentProfile.photoURL || "",
      status: "pending", createdAt: serverTimestamp()
    });

    byId("friendUsernameInput").value = "";
    showSearchMessage(`Request sent to @${username}.`, "success");
    showToast("Request sent", `Waiting for @${username} to accept.`, "success");
  } catch (e) {
    console.error(e);
    showSearchMessage("Could not send the request. Try again.", "error");
  } finally {
    btn && (btn.disabled = false);
  }
}

function subscribeRequests() {
  unsubRequests?.();
  unsubRequests = onSnapshot(
    query(collection(db, "friendRequests"), where("to", "==", currentUser.uid), where("status", "==", "pending")),
    (snap) => renderRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => console.error("requests", e)
  );
}

function renderRequests(reqs) {
  requestCount = reqs.length;
  setText("requestCount", reqs.length);
  const list = byId("requestsList");
  if (!list) return;

  list.innerHTML = reqs.length ? reqs.map((r) => `
    <div class="request-item">
      <img class="request-avatar" src="${esc(r.fromPhoto || initialAvatar(r.fromName))}" alt="" referrerpolicy="no-referrer">
      <div class="request-info"><strong>${esc(r.fromName || r.fromUsername)}</strong><span>@${esc(r.fromUsername || "")}</span></div>
      <div class="request-actions">
        <button type="button" class="request-action accept" data-request-action="accept" data-id="${esc(r.id)}">Accept</button>
        <button type="button" class="request-action reject" data-request-action="reject" data-id="${esc(r.id)}">Decline</button>
      </div>
    </div>`).join("") : `<div class="request-empty">No pending friend requests.</div>`;
}

async function handleRequest(id, action) {
  const ref = doc(db, "friendRequests", id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return showToast("Unavailable", "That request no longer exists.", "error");
    const req = snap.data();

    if (action === "reject") {
      await updateDoc(ref, { status: "rejected", respondedAt: serverTimestamp() });
      return showToast("Request declined", "The request was declined.", "success");
    }

    if ((currentProfile.friendIds || []).length >= MAX_FRIENDS)
      return showToast("Friend limit reached", `You can have up to ${MAX_FRIENDS} friends.`, "error");

    await updateDoc(doc(db, "profiles", currentUser.uid), { friendIds: arrayUnion(req.from) });
    await updateDoc(doc(db, "profiles", req.from), { friendIds: arrayUnion(currentUser.uid) });
    await updateDoc(ref, { status: "accepted", respondedAt: serverTimestamp() });

    showToast("Friend connected", `You and ${req.fromName || "your friend"} can now see each other's progress.`, "success");
    setView(req.from);
  } catch (e) {
    console.error(e);
    showToast("Something went wrong", "Please try again.", "error");
  }
}

async function removeFriend() {
  const uid = viewFriendId;
  if (uid === "all") return closeModal("removeFriendModal");
  try {
    await updateDoc(doc(db, "profiles", currentUser.uid), { friendIds: arrayRemove(uid) });
    // best effort: also remove me from their list
    try { await updateDoc(doc(db, "profiles", uid), { friendIds: arrayRemove(currentUser.uid) }); }
    catch (e) { console.warn("Could not update the other profile", e); }
    showToast("Friend removed", "They were removed from your circle.", "success");
    viewFriendId = "all";
  } catch (e) {
    console.error(e);
    showToast("Could not remove", "Please try again.", "error");
  }
  closeModal("removeFriendModal");
}


/* =========================================================
   12. EVENTS
   ========================================================= */

function bindGlobalEvents() {
  document.addEventListener("click", async (e) => {
    const t = e.target;

    const closeBtn = t.closest("[data-close-modal]");
    if (closeBtn) closeModal(closeBtn.dataset.closeModal);

    if (t.classList?.contains("modal-overlay")) closeModal(t.id);

    if (t.closest("#profileButton, #mobileProfileButton")) openModal("profileModal");
    if (t.closest("#signOutButton, #mobileSignOut")) await logout();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $$(".modal-overlay:not([hidden])").forEach((m) => closeModal(m.id));
  });
}

function bindDashboardEvents() {
  byId("activitiesList")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const { action, id } = b.dataset;
    if (action === "toggle-activity") await toggleActivity(id, todayKey());
    if (action === "edit-activity") openActivityModal(id);
    if (action === "delete-activity") openDeleteModal(id);
  });

  byId("calendarGrid")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-calendar-date]");
    if (!b) return;
    openDayEditor(b.dataset.calendarDate);
  });

  byId("editSelectedDayButton")?.addEventListener("click", () => openDayEditor(selectedDate));

  byId("dayEditorList")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-day-activity]");
    if (!b || !pendingDayChanges) return;
    const id = b.dataset.dayActivity;
    pendingDayChanges[id] = !pendingDayChanges[id];
    renderDayEditor();
  });

  byId("saveDayButton")?.addEventListener("click", saveDay);
  byId("startForm")?.addEventListener("submit", (e) => { e.preventDefault(); saveStartDate(); });
  byId("startTodayButton")?.addEventListener("click", () => (byId("startDateInput").value = todayKey()));
  byId("changeStartButton")?.addEventListener("click", () => { closeModal("profileModal"); openStartModal(false); });
  byId("addActivityButton")?.addEventListener("click", () => openActivityModal());
  byId("mobileAddActivity")?.addEventListener("click", () => openActivityModal());
  byId("confirmDeleteButton")?.addEventListener("click", confirmDelete);
  byId("activityForm")?.addEventListener("submit", (e) => { e.preventDefault(); saveActivity(); });
}

function bindFriendPageEvents() {
  byId("friendRequestForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendFriendRequest(byId("friendUsernameInput").value);
  });

  byId("requestsList")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-request-action]");
    if (b) handleRequest(b.dataset.id, b.dataset.requestAction);
  });

  // friend tabs + "View dashboard" buttons in compare grid
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-friend-tab]");
    if (b) { setView(b.dataset.friendTab); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });

  byId("friendCalendarGrid")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-friend-calendar-date]");
    if (b) openFriendDay(b.dataset.friendCalendarDate);
  });

  byId("removeFriendButton")?.addEventListener("click", () => {
    const f = friends[viewFriendId];
    if (f) setText("removeFriendModalTitle", `Remove ${nameOf(f.profile)}?`);
    openModal("removeFriendModal");
  });
  byId("confirmRemoveFriendButton")?.addEventListener("click", removeFriend);
}

async function logout() {
  try {
    await signOut(auth);
    location.href = "sign-in.html";
  } catch (e) {
    console.error(e);
    showToast("Sign out failed", "Please try again.", "error");
  }
}


/* =========================================================
   13. CLEANUP
   ========================================================= */

window.addEventListener("beforeunload", () => {
  [unsubProfile, unsubActivities, unsubDays, unsubRequests].forEach((u) => u?.());
  Object.values(friends).forEach((f) => f.unsubs.forEach((u) => u()));
  clearInterval(clockTimer);
});