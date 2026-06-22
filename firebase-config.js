import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDGQObyd4h5dYzLgZOxSFDaBY_f9ulJpdI",
    authDomain: "spark-ead35.firebaseapp.com",
    projectId: "spark-ead35",
    storageBucket: "spark-ead35.firebasestorage.app",
    messagingSenderId: "391789994095",
    appId: "1:391789994095:web:374032b2838133dd076d9a"
};

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);