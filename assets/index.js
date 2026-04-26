// 1. Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCfOzZdWyPJE4A_Vz_5h1ElS0_m_EXTenw",
    authDomain: "gatividhiya.firebaseapp.com",
    databaseURL: "https://gatividhiya-default-rtdb.firebaseio.com",
    projectId: "gatividhiya",
    storageBucket: "gatividhiya.firebasestorage.app",
    messagingSenderId: "305825266364",
    appId: "1:305825266364:web:b4e7b0921644f88b632eb9"
};

// 2. Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db_cloud = firebase.firestore();
let unsubscribe = null; // Real-time listener ko rokne ke liye

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

// --- AUTH & REAL-TIME SYNC LOGIC ---

auth.onAuthStateChanged((user) => {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');

    if (user) {
        // UI Updates
        if(loginBtn) loginBtn.style.display = 'none';
        if(userInfo) {
            userInfo.style.display = 'flex';
            document.getElementById('user-name').innerText = user.displayName;
            document.getElementById('user-pic').src = user.photoURL;
        }

        // --- REAL-TIME LISTENER (Main Fix) ---
        // Purane listener ko band karein agar koi chal raha ho
        if (unsubscribe) unsubscribe();

        // Naye data ke liye listen karein
        unsubscribe = db_cloud.collection("users").doc(user.uid)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const cloudData = doc.data().gatividhi_data;
                    if (cloudData) {
                        db = cloudData;
                        localStorage.setItem('toolify_gatividhi_v10', JSON.stringify(db));
                        refreshUI();
                        if (document.getElementById('statsView').style.display === 'block') renderStats();
                        console.log("Cloud se live update mila! ✅");
                    }
                } else {
                    // Agar cloud par data nahi hai, toh local wala upload kar do
                    save();
                }
            }, (error) => {
                console.error("Snapshot error:", error);
            });

    } else {
        // User logged out
        if(unsubscribe) unsubscribe();
        if(loginBtn) loginBtn.style.display = 'block';
        if(userInfo) userInfo.style.display = 'none';
        
        db = JSON.parse(localStorage.getItem('toolify_gatividhi_v10')) || { tasks: [], logs: {}, theme: 'dark' };
        refreshUI();
    }
});

window.handleLogin = function() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(e => alert("Login Failed: " + e.message));
};

window.handleLogout = function() {
    auth.signOut();
};

// --- CORE FUNCTIONS ---

async function save() {
    // 1. Local storage update
    localStorage.setItem('toolify_gatividhi_v10', JSON.stringify(db));

    // 2. Cloud sync (Firestore)
    const user = auth.currentUser;
    if (user) {
        try {
            await db_cloud.collection("users").doc(user.uid).set({
                gatividhi_data: db,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.error("Cloud save failed:", e);
        }
    }
}

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

window.refreshUI = function() {
    const calInput = document.getElementById('calInput');
    if(!calInput) return;
    const date = calInput.value;
    const month = date.substring(0, 7);
    const list = document.getElementById('taskList');
    if(!list) return;
    
    list.innerHTML = '';
    const currentTasks = db.tasks.filter(t => t.month === month);
    
    currentTasks.forEach(t => {
        const isChecked = db.logs[date] && db.logs[date][t.id];
        const div = document.createElement('div');
        div.className = 'item';
        div.innerHTML = `
            <div>
                <div style="font-weight:800">${t.name}</div>
                <div class="action-btns">
                    <span class="badge edit-badge" onclick="openEditModal(${t.id})">Edit</span>
                    <span class="badge del-badge" onclick="openDeleteModal(${t.id})">Delete</span>
                </div>
            </div>
            <label class="switch">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleTask(${t.id})">
                <span class="slider"></span>
            </label>`;
        list.appendChild(div);
    });
}

window.toggleTask = function(id) {
    const date = document.getElementById('calInput').value;
    if(!db.logs[date]) db.logs[date] = {};
    db.logs[date][id] = !db.logs[date][id];
    save(); 
    refreshUI();
}

window.addTask = function() {
    const name = document.getElementById('tName').value.trim();
    const target = parseInt(document.getElementById('tTarget').value);
    const date = document.getElementById('calInput').value;
    if(!name) return;
    db.tasks.push({ id: Date.now(), name, target: target || 30, month: date.substring(0, 7) });
    document.getElementById('tName').value = ''; 
    document.getElementById('tTarget').value = '';
    save(); 
    refreshUI();
}

// --- MODAL & THEME LOGIC ---

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

window.closeModals = function() { 
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); 
}

// Global UI Switch
window.switchView = function(v) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById('tab-' + v);
    if(activeTab) activeTab.classList.add('active');
    
    document.getElementById('trackView').style.display = (v === 'track') ? 'block' : 'none';
    document.getElementById('statsView').style.display = (v === 'stats') ? 'block' : 'none';
    if(v === 'stats') renderStats();
}

// Helper: Clear input with cross
window.clearInput = function(id) {
    document.getElementById(id).value = '';
    document.getElementById(id).focus();
}

// Note: renderStats() and drawCharts() functions as they were, 
// make sure to call save() only when updating data.
