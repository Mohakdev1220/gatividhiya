
// ============================================================
// WINTER ARC — AUTH CHECK
// Protects private pages and redirects signed-out users
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// ------------------------------------------------------------
// FIREBASE CONFIG
// Use the EXACT same Firebase config as sign-in.html and app.js
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// INITIALIZE FIREBASE
// ------------------------------------------------------------

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ------------------------------------------------------------
// PAGE CHECK
// ------------------------------------------------------------

const currentPage =
  window.location.pathname.split("/").pop().toLowerCase() ||
  "index.html";

// These pages require authentication.
const privatePages = [
  "dashboard.html",
  "friend.html"
];

// Pages that should remain publicly accessible.
const publicPages = [
  "",
  "index.html",
  "sign-in.html",
  "about.html"
];

const isPrivatePage = privatePages.includes(currentPage);
const isPublicPage = publicPages.includes(currentPage);

// ------------------------------------------------------------
// AUTH STATE
// ------------------------------------------------------------

if (isPrivatePage) {
  // Keep the page hidden until Firebase finishes checking
  // the existing authentication session.
  document.documentElement.classList.add("auth-checking");

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // Save where the user was trying to go so the sign-in page
      // can optionally return them there after authentication.
      sessionStorage.setItem(
        "winterArcRedirect",
        window.location.href
      );

      window.location.replace("sign-in.html");
      return;
    }

    // User is authenticated.
    document.documentElement.classList.remove("auth-checking");

    // Make the authenticated user available to other scripts.
    window.WinterArcAuthUser = user;

    // Dispatch a custom event so other scripts can react if needed.
    window.dispatchEvent(
      new CustomEvent("winterarc-auth-ready", {
        detail: { user }
      })
    );
  });
}

// ------------------------------------------------------------
// OPTIONAL PUBLIC-PAGE AUTH HANDLING
// ------------------------------------------------------------
//
// If a signed-in user opens sign-in.html directly, send them
// back to the dashboard instead of showing the login screen.
//
// Do NOT redirect index.html or about.html automatically.
// They remain public landing/information pages.
//

if (currentPage === "sign-in.html") {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;

    const savedRedirect = sessionStorage.getItem(
      "winterArcRedirect"
    );

    sessionStorage.removeItem("winterArcRedirect");

    if (
      savedRedirect &&
      savedRedirect.includes("dashboard.html")
    ) {
      window.location.replace(savedRedirect);
      return;
    }

    if (
      savedRedirect &&
      savedRedirect.includes("friend.html")
    ) {
      window.location.replace(savedRedirect);
      return;
    }

    window.location.replace("dashboard.html");
  });
}

// ------------------------------------------------------------
// GLOBAL AUTH HELPER
// ------------------------------------------------------------

window.WinterArcAuth = {
  getUser() {
    return auth.currentUser;
  },

  isSignedIn() {
    return Boolean(auth.currentUser);
  },

  getAuth() {
    return auth;
  }
};