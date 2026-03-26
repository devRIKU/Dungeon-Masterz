import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, Auth } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';

export let app: FirebaseApp;
export let auth: Auth;
export let db: Firestore;
export let googleProvider: GoogleAuthProvider;

export const initializeFirebase = async () => {
  if (app) return;
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.firebaseConfig) {
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
      console.error("Firebase config not found from backend.");
    }
  } catch (e) {
    console.error("Failed to initialize Firebase", e);
  }
};

export const signInWithGoogle = () => {
  if (!auth || !googleProvider) throw new Error("Firebase not initialized");
  return signInWithPopup(auth, googleProvider);
};
