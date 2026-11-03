import { initializeDraftOwner, scopedStorage } from '../accountStorage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, collection, query, where, getDocsFromServer } from 'firebase/firestore';
import { auth, db, googleProvider } from '../services/firebase';

interface AuthContextType {
  user: User | null;
  role: 'admin' | 'user' | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isApproved: boolean;
  googleAccessToken: string | null;
  reconnectGoogle: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  isApproved: false,
  googleAccessToken: null,
  reconnectGoogle: async () => null,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);

  useEffect(() => {
    let revision = 0;
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      const currentRevision = ++revision;
      setLoading(true);
      setRole(null);
      setUser(currentUser);
      setGoogleAccessToken(null);
      let nextRole: 'admin' | 'user' | null = null;
      try {
        try {
          initializeDraftOwner(localStorage, currentUser?.uid || null);
          setGoogleAccessToken(scopedStorage(localStorage, currentUser?.uid || null).getItem('googleAccessToken'));
        } catch { /* Storage may be disabled. */ }
        if (!currentUser?.emailVerified || !currentUser.email) return;
        if (currentUser.email === 'kanata840@gmail.com') {
          nextRole = 'admin';
          return;
        }
        const email = currentUser.email.toLowerCase().trim();
        const direct = await getDocFromServer(doc(db, 'users', email));
        let value = direct.data()?.role;
        if (!direct.exists()) {
          const legacy = await getDocsFromServer(query(collection(db, 'users'), where('email', '==', currentUser.email)));
          value = legacy.docs[0]?.data().role;
        }
        if (value === 'admin' || value === 'user') nextRole = value;
      } catch {
        console.warn('Chart access could not be verified.');
      } finally {
        if (currentRevision === revision) {
          setRole(nextRole);
          setLoading(false);
        }
      }
    });
    return () => { revision++; unsubscribeAuth(); };
  }, []);

  const login = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleAccessToken(credential.accessToken);
        scopedStorage(localStorage, result.user.uid).setItem('googleAccessToken', credential.accessToken);
      }
    } catch (err) {
      console.warn('Google sign-in did not complete.');
    }
  };

  const reconnectGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleAccessToken(credential.accessToken);
        scopedStorage(localStorage, result.user.uid).setItem('googleAccessToken', credential.accessToken);
        return credential.accessToken;
      }
    } catch (err) {
      console.warn('Google sign-in did not complete.');
    }
    return null;
  };

  const logout = async () => {
    setGoogleAccessToken(null);
    scopedStorage(localStorage, auth.currentUser?.uid || null).removeItem('googleAccessToken');
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, login, logout, isApproved: role !== null, googleAccessToken, reconnectGoogle }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
