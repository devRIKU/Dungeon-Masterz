import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, Auth } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';

export let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let db: Firestore | null = null;
export let googleProvider: GoogleAuthProvider | null = null;

export const initializeFirebase = async () => {
  if (app) return;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch('/api/config', { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`);
    const data = await res.json();
    
    if (data.firebaseConfig && data.firebaseConfig.apiKey) {
      app = initializeApp(data.firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app, data.firebaseConfig.firestoreDatabaseId);
      googleProvider = new GoogleAuthProvider();
      
      // Test connection
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    } else {
      console.warn("Firebase config not found or incomplete from backend. App will run in limited mode.");
    }
  } catch (e) {
    console.error("Failed to initialize Firebase", e);
  }
};

export const signInWithGoogle = () => {
  if (!auth || !googleProvider) throw new Error("Firebase not initialized or configured");
  return signInWithPopup(auth, googleProvider);
};
