// 1. Firebase Configuration (Fixed syntax)
const firebaseConfig = {
    apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
    authDomain: "gatividhiya.firebaseapp.com",
    databaseURL: "https://gatividhiya-default-rtdb.firebaseio.com",
    projectId: "gatividhiya",
    storageBucket: "gatividhiya.firebasestorage.app",
    messagingSenderId: "305825266364",
    appId: "1:305825266364:web:b4e7b0921644f88b632eb9"
};

// 2. Initialize Firebase (Compat mode for global access)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db_cloud = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

// 3. App State
let db = JSON.parse(localStorage.getItem('toolify_gatividhi_v10')) || { tasks: [], logs: {}, theme: 'dark' };
let offsetDays = 0, lChart = null, pChart = null;

// 4. Initialize on Load
window.onload = () => {
    document.body.setAttribute('data-theme', db.theme || 'dark');
    const today = new Date().toISOString().split('T')[0];
    if(document.getElementById('calInput')) document.getElementById('calInput').value = today;
    startClock(); 
    refreshUI();
};

// --- FINAL AUTH LOGIC ---

// 1. Login Function (Isse pata chalega agar popup block ho raha hai)
window.handleLogin = function() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            console.log("Logged in:", result.user.displayName);
        })
        .catch((error) => {
            console.error("Auth Error:", error.message);
            if (error.code === 'auth/popup-blocked') {
                alert("Popup block ho gaya hai! Browser ki settings mein ise allow karein.");
            } else {
                alert("Login nahi ho paya: " + error.message);
            }
        });
};

// 2. Logout Function
window.handleLogout = function() {
    auth.signOut();
};

// 3. Auth Observer (UI Update aur Data Sync)
auth.onAuthStateChanged(async (user) => {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');

    if (user) {
        // User login hai
        if(loginBtn) loginBtn.style.display = 'none';
        if(userInfo) {
            userInfo.style.display = 'flex';
            document.getElementById('user-name').innerText = user.displayName;
            document.getElementById('user-pic').src = user.photoURL;
        }

        // Logout button par function bind karein
        const logoutBtn = document.getElementById('logout-btn');
        if(logoutBtn) logoutBtn.onclick = window.handleLogout;

        // Cloud se data load karo
        try {
            const docSnap = await db_cloud.collection("users").doc(user.uid).get();
            if (docSnap.exists) {
                db = docSnap.data().gatividhi_data;
                refreshUI();
            } else {
                save(); // Naya user hai to local data upload kar do
            }
        } catch(e) { console.error("Cloud Load Error", e); }
        
    } else {
        // User logged out hai
        if(loginBtn) {
            loginBtn.style.display = 'block';
            loginBtn.onclick = window.handleLogin; // Button click par login trigger
        }
        if(userInfo) userInfo.style.display = 'none';
        
        // Local data dikhao
        db = JSON.parse(localStorage.getItem('toolify_gatividhi_v10')) || { tasks: [], logs: {}, theme: 'dark' };
        refreshUI();
    }
});

// --- CORE FUNCTIONS (Global access ke liye window object mein daal rahe hain) ---
window.startClock = function() {
    const update = () => {
        const now = new Date();
        const timeEl = document.getElementById('liveTime');
        const dateEl = document.getElementById('liveDate');
        if(timeEl) timeEl.innerText = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if(dateEl) dateEl.innerText = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
    };
    update(); setInterval(update, 1000);
}

window.save = function() {
    localStorage.setItem('toolify_gatividhi_v10', JSON.stringify(db));
    const user = auth.currentUser;
    if (user) {
        db_cloud.collection("users").doc(user.uid).set({
            gatividhi_data: db,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

window.switchView = function(v) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + v).classList.add('active');
    document.getElementById('trackView').style.display = (v === 'track') ? 'block' : 'none';
    document.getElementById('statsView').style.display = (v === 'stats') ? 'block' : 'none';
    if(v === 'stats') renderStats();
}

window.addTask = function() {
    const name = document.getElementById('tName').value.trim();
    const target = parseInt(document.getElementById('tTarget').value);
    const date = document.getElementById('calInput').value;
    if(!name) return;
    db.tasks.push({ id: Date.now(), name, target: target || 30, month: date.substring(0, 7) });
    document.getElementById('tName').value = ''; 
    document.getElementById('tTarget').value = '';
    save(); refreshUI();
}

window.quickAdd = function(name) {
    document.getElementById('tName').value = name;
    document.getElementById('tTarget').focus();
}

window.toggleTask = function(id) {
    const date = document.getElementById('calInput').value;
    if(!db.logs[date]) db.logs[date] = {};
    db.logs[date][id] = !db.logs[date][id];
    save(); refreshUI();
}

window.refreshUI = function() {
    const date = document.getElementById('calInput').value;
    const month = date.substring(0, 7);
    const list = document.getElementById('taskList');
    if(!list) return;
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

// Stats functions
window.renderStats = function() {
    const date = document.getElementById('calInput').value, month = date.substring(0, 7);
    const tasks = db.tasks.filter(t => t.month === month);
    const list = document.getElementById('monthList');
    if(!list) return;
    list.innerHTML = `<h3 style="font-size:0.75rem; color:var(--text-dim); margin-top:20px; text-transform:uppercase; font-weight:800;">Monthly Progress</h3>`;
    tasks.forEach(t => {
        let done = 0;
        Object.keys(db.logs).forEach(d => { if(d.startsWith(month) && db.logs[d][t.id]) done++; });
        const percent = Math.min(100, (done / t.target) * 100);
        list.innerHTML += `<div class="summary-box"><div class="summary-info"><span>${t.name}</span><span>${done}/${t.target}</span></div><div class="progress-bar"><div class="progress-fill" style="width: ${percent}%"></div></div></div>`;
    });
    drawCharts(date, tasks);
}

window.changeGraphRange = function(dir) { offsetDays += (dir * 7); renderStats(); }

window.drawCharts = function(selDate, tasks) {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textCol = isDark ? '#94a3b8' : '#64748b';
    const ctxL = document.getElementById('lineChart');
    const ctxP = document.getElementById('pieChart');
    if(!ctxL || !ctxP) return;

    if(lChart) lChart.destroy(); if(pChart) pChart.destroy();

    const labels = [], dataArr = [];
    const baseDate = new Date(selDate); baseDate.setDate(baseDate.getDate() + offsetDays - 6);
    for(let i=0; i<7; i++) {
        const d = new Date(baseDate); d.setDate(baseDate.getDate() + i);
        const ds = d.toISOString().split('T')[0];
        labels.push(d.getDate() + "/" + (d.getMonth() + 1));
        dataArr.push(Object.values(db.logs[ds] || {}).filter(v => v === true).length);
    }
    document.getElementById('rangeLabel').innerText = `(${labels[0]} - ${labels[6]})`;

    lChart = new Chart(ctxL, { type: 'line', data: { labels, datasets: [{ data: dataArr, borderColor: '#3b82f6', tension: 0.4, fill: true, backgroundColor: 'rgba(59, 130, 246, 0.1)' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textCol, stepSize: 1 } }, x: { ticks: { color: textCol } } } } });
    
    const logsToday = db.logs[selDate] || {};
    const done = tasks.filter(t => logsToday[t.id]).length, total = tasks.length || 1;
    pChart = new Chart(ctxP, { type: 'doughnut', data: { labels: ['Done', 'Left'], datasets: [{ data: [done, Math.max(0, total-done)], backgroundColor: ['#10b981', isDark ? '#26292f' : '#e2e8f0'], borderWidth: 0 }] }, options: { cutout: '80%', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textCol } } } } });
}

window.toggleTheme = function() { 
    db.theme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; 
    document.body.setAttribute('data-theme', db.theme); 
    save(); 
}

window.openEditModal = function(id) {
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

window.openDeleteModal = function(id) {
    document.getElementById('deleteModal').style.display = 'flex';
    document.getElementById('confirmDelBtn').onclick = () => {
        db.tasks = db.tasks.filter(t => t.id !== id);
        save(); refreshUI(); closeModals();
    };
}

window.closeModals = function() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); }
