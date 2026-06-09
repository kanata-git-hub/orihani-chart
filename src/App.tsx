/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { LoginPage, UnauthorizedPage } from './pages/AuthPages';
import { AdminPage } from './pages/AdminPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { usePatientData } from './hooks/usePatientData';
import { generateAIChart } from './services/aiService';
import { Header } from './components/Header';
import { PatientBriefingForm } from './components/PatientBriefingForm';
import { AnalysisOutput } from './components/AnalysisOutput';
import { ResetModal } from './components/ResetModal';
import { FollowUpTab } from './components/FollowUpTab';

type AppMode = 'INITIAL' | 'FOLLOW_UP';

function MainApp() {
  const {
    activeTab,
    setActiveTab,
    patientData,
    isSaved,
    updateBriefingField,
    updateResult,
    resetTab,
    resetAllTabs
  } = usePatientData();

  const { role, user, logout } = useAuth();
  const navigate = useNavigate();

  const [appMode, setAppMode] = useState<AppMode>('INITIAL');
  const [isLoading, setIsLoading] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isGlobalResetModalOpen, setIsGlobalResetModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetCounter, setResetCounter] = useState(0);

  const briefing = patientData[activeTab].briefing;
  const result = patientData[activeTab].result;

  const handleGenerateChart = async (audioData?: { mimeType: string, data: string }) => {
    setIsLoading(true);
    setError(null);
    try {
      const parsedResult = await generateAIChart(briefing, audioData);
      updateResult(activeTab, parsedResult);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : '차트 생성 중 오류가 발생했습니다.';
      setError(`차트 생성 실패: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmReset = () => {
    resetTab(activeTab);
    setResetCounter(c => c + 1);
    setIsResetModalOpen(false);
  };

  const confirmGlobalReset = () => {
    // Reset all tabs both in local state and follow ups
    resetAllTabs();
    
    // As FollowUp is managed by another hook without context, we can clear its storage directly
    // Then we trigger a re-render or just let the resetAllTabs do its job and reload to apply to FollowUp
    localStorage.removeItem('patientData');
    localStorage.removeItem('followUpData');
    window.location.reload();
  };

  const isAdmin = role === 'admin' || user?.email === 'kanata840@gmail.com';

  return (
    <div className="min-h-screen bg-bg-light text-primary p-4 md:p-8">
      <div className="max-w-[1800px] mx-auto">
        {/* Top App Mode Toggle */}
        <div className="flex justify-end gap-2 mb-4 hidden lg:flex">
          <button 
            onClick={logout}
            className="px-6 py-2.5 border-2 border-primary font-bold text-lg transition-colors bg-white text-primary hover:bg-primary/5"
            title="로그아웃"
          >
            로그아웃
          </button>
          {isAdmin && (
            <button 
              onClick={() => navigate('/admin')}
              className="px-8 py-2.5 border-2 border-primary font-bold text-lg transition-colors bg-white text-primary hover:bg-primary/5"
            >
              관리
            </button>
          )}
          <button 
            onClick={() => setAppMode('INITIAL')}
            className={`px-8 py-2.5 border-2 border-primary font-bold text-lg transition-colors ${appMode === 'INITIAL' ? 'bg-accent text-primary shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] translate-y-[-2px]' : 'bg-white text-primary hover:bg-primary/5'}`}
          >
            초진 자동 차트
          </button>
          <button 
            onClick={() => setAppMode('FOLLOW_UP')}
            className={`px-8 py-2.5 border-2 border-primary font-bold text-lg transition-colors ${appMode === 'FOLLOW_UP' ? 'bg-accent text-primary shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] translate-y-[-2px]' : 'bg-white text-primary hover:bg-primary/5'}`}
          >
            처방 재평가실 (오답노트)
          </button>
        </div>

        <Header activeTab={activeTab} setActiveTab={setActiveTab} onResetAll={() => setIsGlobalResetModalOpen(true)} />
        
        {/* Mobile App Mode Toggle */}
        <div className="flex justify-center gap-2 mb-6 lg:hidden">
          <button 
            onClick={logout}
            className="py-3 px-4 border-2 border-primary font-bold text-sm transition-colors bg-white text-primary whitespace-nowrap"
            title="로그아웃"
          >
            로그아웃
          </button>
          {isAdmin && (
            <button 
              onClick={() => navigate('/admin')}
              className="flex-1 py-3 border-2 border-primary font-bold text-sm lg:text-lg transition-colors bg-white text-primary"
            >
              관리
            </button>
          )}
          <button 
            onClick={() => setAppMode('INITIAL')}
            className={`flex-1 py-3 border-2 border-primary font-bold text-sm lg:text-lg transition-colors ${appMode === 'INITIAL' ? 'bg-accent text-primary shadow-[4px_4px_0px_0px_rgba(85,44,36,1)]' : 'bg-white text-primary'}`}
          >
            초진 차트
          </button>
          <button 
            onClick={() => setAppMode('FOLLOW_UP')}
            className={`flex-1 py-3 border-2 border-primary font-bold text-sm lg:text-lg transition-colors ${appMode === 'FOLLOW_UP' ? 'bg-accent text-primary shadow-[4px_4px_0px_0px_rgba(85,44,36,1)]' : 'bg-white text-primary'}`}
          >
            처방 재평가
          </button>
        </div>

        {appMode === 'INITIAL' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Input Section */}
            <section className="lg:col-span-4 xl:col-span-3 space-y-6">
              <PatientBriefingForm 
                key={`${activeTab}-${resetCounter}`}
                activeTab={activeTab}
                briefing={briefing}
                isSaved={isSaved}
                isLoading={isLoading}
                onFieldChange={(name, value) => updateBriefingField(activeTab, name, value)}
                onResetClick={() => setIsResetModalOpen(true)}
                onGenerateClick={handleGenerateChart}
              />


              {error && (
                <div className="bg-red-50 border border-red-500 p-4 flex items-start gap-3 text-red-700 shadow-[4px_4px_0px_0px_rgba(239,68,68,0.2)]">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}
            </section>

            {/* Output Section */}
            <section className="lg:col-span-8 xl:col-span-9 space-y-6">
              <AnalysisOutput result={result} />
            </section>
          </div>
        ) : (
          /* Follow-Up Chat Mode View */
          <div className="mt-4">
            <FollowUpTab activeTab={activeTab} />
          </div>
        )}
      </div>

      <ResetModal 
        isOpen={isResetModalOpen}
        activeTab={activeTab}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={confirmReset}
      />

      <ResetModal 
        isOpen={isGlobalResetModalOpen}
        activeTab={activeTab} // Not actually used by title/message since we override them
        title="모든 환자 데이터 전체 초기화"
        message="환자 1부터 10까지의 모든 초진 차트 및 처방 재평가 데이터가 완전히 삭제됩니다. 정말 초기화하시겠습니까?"
        onClose={() => setIsGlobalResetModalOpen(false)}
        onConfirm={confirmGlobalReset}
      />

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}} />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route path="/admin" element={
        <ProtectedRoute requireAdmin={true}>
          <AdminPage />
        </ProtectedRoute>
      } />
      <Route path="/" element={
        <ProtectedRoute>
          <MainApp />
        </ProtectedRoute>
      } />
    </Routes>
  );
}
