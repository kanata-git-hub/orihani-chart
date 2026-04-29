import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, setDoc, deleteDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Trash2 } from 'lucide-react';

export const AdminPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [emailInput, setEmailInput] = useState('');
  const [roleInput, setRoleInput] = useState<'user' | 'admin'>('user');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'));
      const snapshot = await getDocs(q);
      let fetchedUsers: any[] = [];
      
      for (const document of snapshot.docs) {
        const data = document.data();
        let docId = document.id;
        
        // Migrate old users with auto-generated IDs
        if (data.email) {
          const cleanEmail = data.email.toLowerCase().trim();
          if (docId !== cleanEmail) {
            try {
              await setDoc(doc(db, 'users', cleanEmail), {
                ...data,
                email: cleanEmail
              });
              await deleteDoc(doc(db, 'users', docId));
              docId = cleanEmail;
            } catch (e) {
              console.error('Migration failed for user', data.email, e);
            }
          }
        }
        
        fetchedUsers.push({ id: docId, ...data });
      }
      
      // 중복된 유저가 있으면 제거 (동일한 이메일)
      const uniqueUsersMap = new Map();
      for (const u of fetchedUsers) {
        if (u.email) {
          uniqueUsersMap.set(u.email.toLowerCase().trim(), u);
        }
      }
      fetchedUsers = Array.from(uniqueUsersMap.values());
      
      // 최고 관리자 계정이 목록에 없으면 맨 위에 추가하여 항상 보이게 함
      if (!fetchedUsers.some(u => u.email === 'kanata840@gmail.com')) {
        fetchedUsers = [{ id: 'kanata840@gmail.com', email: 'kanata840@gmail.com', role: 'admin' }, ...fetchedUsers];
      }
      
      setUsers(fetchedUsers);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput) return;
    const cleanEmail = emailInput.trim().toLowerCase();
    
    if (cleanEmail === 'kanata840@gmail.com') {
      setError('최고 관리자 계정은 임의로 추가하거나 권한을 변경할 수 없습니다.');
      return;
    }
    setError(null);
    try {
      await setDoc(doc(db, 'users', cleanEmail), {
        email: cleanEmail,
        role: roleInput,
        createdAt: serverTimestamp(),
        createdBy: user?.uid
      });
      setEmailInput('');
      fetchUsers();
    } catch (err: any) {
      if (err instanceof Error) {
        try { handleFirestoreError(err, OperationType.CREATE, 'users'); } catch (_) {}
      }
      setError('사용자 추가 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteUser = async (id: string) => {
    const userToDelete = users.find(u => u.id === id);
    if (userToDelete?.email === 'kanata840@gmail.com' || id === 'super-admin-fixed') {
      setError('최고 관리자는 삭제할 수 없습니다.');
      return;
    }
    
    setError(null);
    try {
      await deleteDoc(doc(db, 'users', id));
      fetchUsers();
    } catch (err: any) {
      if (err instanceof Error) {
        try { handleFirestoreError(err, OperationType.DELETE, `users/${id}`); } catch (_) {}
      }
      setError('사용자 삭제 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-bg-light text-primary p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">관리자 페이지</h1>
          <button 
            onClick={() => navigate('/')}
            className="px-6 py-2 border-2 border-primary bg-white hover:bg-primary/5 transition-colors font-bold shadow-[4px_4px_0px_0px_rgba(85,44,36,1)]"
          >
            메인으로 돌아가기
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-500 p-4 mb-6 flex items-start gap-3 text-red-700 shadow-[4px_4px_0px_0px_rgba(239,68,68,0.2)]">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="bg-white border-2 border-primary p-6 mb-8 shadow-[8px_8px_0px_0px_rgba(85,44,36,1)]">
          <h2 className="text-xl font-bold mb-4">새 회원 승인</h2>
          <form onSubmit={handleAddUser} className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-bold mb-2">이메일</label>
              <input 
                type="email" 
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full p-3 border-2 border-primary bg-bg-light focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="user@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-2">권한</label>
              <select 
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as 'user' | 'admin')}
                className="p-3 border-2 border-primary bg-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="user">일반 회원 (user)</option>
                <option value="admin">관리자 (admin)</option>
              </select>
            </div>
            <button 
              type="submit"
              className="px-6 py-3 bg-accent border-2 border-primary font-bold hover:shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] transition-all"
            >
              등록
            </button>
          </form>
        </div>

        <div className="bg-white border-2 border-primary p-6 shadow-[8px_8px_0px_0px_rgba(85,44,36,1)]">
          <h2 className="text-xl font-bold mb-4">승인된 회원 목록</h2>
          {loading ? (
            <p>로딩 중...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-primary">
                    <th className="p-3 font-bold text-primary">이메일</th>
                    <th className="p-3 font-bold text-primary">권한</th>
                    <th className="p-3 font-bold text-primary text-center">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-primary/70">등록된 회원이 없습니다.</td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.email} className="border-b border-primary/20 hover:bg-bg-light">
                        <td className="p-3">{u.email}</td>
                        <td className="p-3">
                          <span className={`inline-block px-2 py-1 text-xs font-bold border ${u.email === 'kanata840@gmail.com' || u.role === 'admin' ? 'bg-primary text-white' : 'bg-white border-primary text-primary'}`}>
                            {u.email === 'kanata840@gmail.com' ? 'SUPER ADMIN' : u.role?.toUpperCase() || 'USER'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {u.email !== 'kanata840@gmail.com' && (
                            <button 
                              onClick={() => handleDeleteUser(u.id)}
                              className="p-2 text-red-500 hover:bg-red-50 border border-transparent hover:border-red-500 transition-colors"
                              title="삭제"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
