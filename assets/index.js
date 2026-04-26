
    let db = JSON.parse(localStorage.getItem('toolify_gatividhi_v10')) || { tasks: [], logs: {}, theme: 'dark' };
    let offsetDays = 0, lChart = null, pChart = null;

    window.onload = () => {
        document.body.setAttribute('data-theme', db.theme || 'dark');
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('calInput').value = today;
        startClock(); refreshUI();
    };

    function startClock() {
        const update = () => {
            const now = new Date();
            document.getElementById('liveTime').innerText = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            document.getElementById('liveDate').innerText = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
        };
        update(); setInterval(update, 1000);
    }

    function switchView(v) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + v).classList.add('active');
        document.getElementById('trackView').style.display = (v === 'track') ? 'block' : 'none';
        document.getElementById('statsView').style.display = (v === 'stats') ? 'block' : 'none';
        if(v === 'stats') renderStats();
    }

    function addTask() {
        const name = document.getElementById('tName').value.trim();
        const target = parseInt(document.getElementById('tTarget').value);
        const date = document.getElementById('calInput').value;
        if(!name) return;
        db.tasks.push({ id: Date.now(), name, target: target || 30, month: date.substring(0, 7) });
        document.getElementById('tName').value = ''; document.getElementById('tTarget').value = '';
        save(); refreshUI();
    }

    function quickAdd(name) {
        document.getElementById('tName').value = name;
        document.getElementById('tTarget').focus();
    }

    function openEditModal(id) {
        const task = db.tasks.find(t => t.id === id);
        document.getElementById('editName').value = task.name;
        document.getElementById('editTarget').value = task.target;
        document.getElementById('editModal').style.display = 'flex';
        document.getElementById('saveEditBtn').onclick = () => {
            task.name = document.getElementById('editName').value;
            task.target = parseInt(document.getElementById('editTarget').value);
            save(); refreshUI(); closeModals();
        };
    }

    function openDeleteModal(id) {
        document.getElementById('deleteModal').style.display = 'flex';
        document.getElementById('confirmDelBtn').onclick = () => {
            db.tasks = db.tasks.filter(t => t.id !== id);
            save(); refreshUI(); closeModals();
        };
    }

    function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); }

    function toggleTask(id) {
        const date = document.getElementById('calInput').value;
        if(!db.logs[date]) db.logs[date] = {};
        db.logs[date][id] = !db.logs[date][id];
        save(); refreshUI();
    }

    function refreshUI() {
        const date = document.getElementById('calInput').value;
        const month = date.substring(0, 7);
        const list = document.getElementById('taskList');
        list.innerHTML = '';
        const currentTasks = db.tasks.filter(t => t.month === month);
        currentTasks.forEach(t => {
            const isChecked = db.logs[date] && db.logs[date][t.id];
            const div = document.createElement('div');
            div.className = 'item';
            div.innerHTML = `<div><div style="font-weight:800">${t.name}</div><div class="action-btns"><span class="badge edit-badge" onclick="openEditModal(${t.id})">Edit</span><span class="badge del-badge" onclick="openDeleteModal(${t.id})">Delete</span></div></div><label class="switch"><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleTask(${t.id})"><span class="slider"></span></label>`;
            list.appendChild(div);
        });
    }

    function renderStats() {
        const date = document.getElementById('calInput').value, month = date.substring(0, 7);
        const tasks = db.tasks.filter(t => t.month === month);
        const list = document.getElementById('monthList');
        list.innerHTML = `<h3 style="font-size:0.75rem; color:var(--text-dim); margin-top:20px; text-transform:uppercase; font-weight:800;">Monthly Progress</h3>`;
        tasks.forEach(t => {
            let done = 0;
            Object.keys(db.logs).forEach(d => { if(d.startsWith(month) && db.logs[d][t.id]) done++; });
            const percent = Math.min(100, (done / t.target) * 100);
            list.innerHTML += `<div class="summary-box"><div class="summary-info"><span>${t.name}</span><span>${done}/${t.target}</span></div><div class="progress-bar"><div class="progress-fill" style="width: ${percent}%"></div></div></div>`;
        });
        drawCharts(date, tasks);
    }

    function changeGraphRange(dir) { offsetDays += (dir * 7); renderStats(); }

    function drawCharts(selDate, tasks) {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const textCol = isDark ? '#94a3b8' : '#64748b';
        if(lChart) lChart.destroy(); if(pChart) pChart.destroy();

        const labels = [], data = [];
        const baseDate = new Date(selDate); baseDate.setDate(baseDate.getDate() + offsetDays - 6);
        for(let i=0; i<7; i++) {
            const d = new Date(baseDate); d.setDate(baseDate.getDate() + i);
            const ds = d.toISOString().split('T')[0];
            labels.push(d.getDate() + "/" + (d.getMonth() + 1));
            data.push(Object.values(db.logs[ds] || {}).filter(v => v === true).length);
        }
        document.getElementById('rangeLabel').innerText = `(${labels[0]} - ${labels[6]})`;

        lChart = new Chart(document.getElementById('lineChart'), { type: 'line', data: { labels, datasets: [{ data, borderColor: '#3b82f6', tension: 0.4, fill: true, backgroundColor: 'rgba(59, 130, 246, 0.1)' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textCol, stepSize: 1 } }, x: { ticks: { color: textCol } } } } });
        
        const logsToday = db.logs[selDate] || {};
        const done = tasks.filter(t => logsToday[t.id]).length, total = tasks.length || 1;
        pChart = new Chart(document.getElementById('pieChart'), { type: 'doughnut', data: { labels: ['Done', 'Left'], datasets: [{ data: [done, Math.max(0, total-done)], backgroundColor: ['#10b981', isDark ? '#26292f' : '#e2e8f0'], borderWidth: 0 }] }, options: { cutout: '80%', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textCol } } } } });
    }

    function toggleTheme() { db.theme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.body.setAttribute('data-theme', db.theme); save(); }
    function save() { localStorage.setItem('toolify_gatividhi_v10', JSON.stringify(db)); } 
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

// आपकी Firebase Config
const firebaseConfig = {
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
  authDomain: "gatividhiya.firebaseapp.com",
  databaseURL: "https://gatividhiya-default-rtdb.firebaseio.com",
  projectId: "gatividhiya",
  storageBucket: "gatividhiya.firebasestorage.app",
  messagingSenderId: "305825266364",
  appId: "1:305825266364:web:b4e7b0921644f88b632eb9",

};

// Initialize
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// UI Elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const userPic = document.getElementById('user-pic');

// --- Functions ---

// 1. Sign In function
loginBtn.onclick = async () => {
    try {
        await signInWithPopup(auth, provider);
        console.log("Logged in successfully!");
    } catch (error) {
        console.error("Login Error:", error.message);
    }
};

// 2. Sign Out function
logoutBtn.onclick = () => signOut(auth);

// 3. Monitor Auth State (Ye apne aap pata kar lega user logged in hai ya nahi)
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User login hai
        loginBtn.style.display = 'none';
        userInfo.style.display = 'flex';
        userName.innerText = user.displayName;
        userPic.src = user.photoURL;
        
        console.log("Welcome,", user.displayName);
        // यहाँ से आप Cloud (Firestore) से डेटा लोड करने का फंक्शन कॉल कर सकते हैं
    } else {
        // User logged out hai
        loginBtn.style.display = 'block';
        userInfo.style.display = 'none';
        
        console.log("User is signed out (Local Mode)");
        // यहाँ आप LocalStorage वाला डेटा दिखा सकते हैं
    }
});
