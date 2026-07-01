import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Navigate } from 'react-router-dom';
import { SplashScreen } from '../components/SplashScreen';

export const LoginPage: React.FC = () => {
  const { login, user, loading } = useAuth();

  if (loading) return <SplashScreen />;

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-bg-light flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border-2 border-primary p-8 shadow-[8px_8px_0px_0px_rgba(85,44,36,1)] text-center">
        <h1 className="text-3xl font-bold text-primary mb-6">AI 진료 차트</h1>
        <p className="text-primary mb-8 leading-relaxed">
          인가된 사용자만 접근할 수 있습니다.<br />
          구글 계정으로 로그인해주세요.
        </p>
        <button 
          onClick={login}
          className="w-full py-4 bg-accent border-2 border-primary text-primary font-bold text-lg hover:shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] transition-all hover:-translate-y-1"
        >
          Google 로그인
        </button>
      </div>
    </div>
  );
};

export const UnauthorizedPage: React.FC = () => {
  const { logout, user } = useAuth();

  const handleSwapAccount = async () => {
    try {
      const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
      const { auth } = await import('../services/firebase');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
    }
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-bg-light flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border-2 border-primary p-8 shadow-[8px_8px_0px_0px_rgba(85,44,36,1)] text-center">
        <div className="mx-auto w-16 h-16 bg-red-100 border-2 border-red-500 flex items-center justify-center rounded-full mb-6 text-red-500">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-primary mb-4">접근 권한이 없습니다</h1>
        <p className="text-primary mb-2 break-all"><b>{user?.email}</b></p>
        <p className="text-primary mb-8 text-sm">해당 이메일은 관리자의 승인을 받지 못했습니다. 권한을 요청해주세요.</p>
        <button 
          onClick={handleSwapAccount}
          className="w-full py-3 bg-white border-2 border-primary text-primary font-bold hover:bg-bg-light transition-colors"
        >
          다른 계정으로 로그인
        </button>
        <button 
          onClick={logout}
          className="w-full py-3 mt-4 bg-transparent border-2 border-transparent text-primary/70 font-bold hover:text-primary transition-colors text-sm"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
};
