import { initializeDraftOwner, scopedStorage } from '../accountStorage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../services/firebase';

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
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      try { initializeDraftOwner(localStorage, currentUser?.uid || null); } catch { /* Storage may be disabled. */ }
      setLoading(true);
      setUser(currentUser);
      setGoogleAccessToken(scopedStorage(localStorage, currentUser?.uid || null).getItem('googleAccessToken'));
      if (currentUser) {
        if (currentUser.email === 'kanata840@gmail.com') {
          // Super admin is always an admin
          setRole('admin');
          setLoading(false);
          return;
        }

        try {
          if (currentUser.email) {
            const cleanUserEmail = currentUser.email.toLowerCase().trim();
            const docRef = doc(db, 'users', cleanUserEmail);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const userData = docSnap.data();
              setRole(userData.role as 'admin' | 'user');
            } else {
              // Fallback for older documents with auto-generated IDs
              try {
                const q = query(collection(db, 'users'), where('email', '==', currentUser.email));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                  const userData = querySnapshot.docs[0].data();
                  setRole(userData.role as 'admin' | 'user');
                  return;
                }
              } catch (e) {
                console.warn('Fallback getDocs failed (likely permissions for non-existing users):', e);
              }
              setRole(null);
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, 'users');
        } finally {
          setLoading(false);
        }
      } else {
        setRole(null);
        setGoogleAccessToken(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
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
      console.error(err);
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
      console.error(err);
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
