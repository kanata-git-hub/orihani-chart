import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../services/firebase';

interface AuthContextType {
  user: User | null;
  role: 'admin' | 'user' | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  isApproved: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  isApproved: false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
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
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, login, logout, isApproved: role !== null }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
