import React from 'react';

interface HeaderProps {
  activeTab: number;
  setActiveTab: (tab: number) => void;
  onResetAll?: () => void;
  showPatientTabs?: boolean;
  mobileActions?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onResetAll, showPatientTabs = true, mobileActions }) => {
  return (
    <header className="mb-3 lg:mb-6 border-b border-primary pb-3 lg:pb-4 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-3 lg:gap-4">
      <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto lg:gap-4 lg:shrink-0">
        <img src="/icon.png?v=2" alt="AI 도우미" className="w-11 h-11 lg:w-16 lg:h-16 object-contain shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-4xl font-bold tracking-tight break-keep">오리 차트</h1>
          <p className="text-xs lg:text-sm font-mono opacity-60 lg:mt-2 break-keep">AI 진단 지원 시스템 v1.2</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center text-sm font-bold lg:hidden">{mobileActions}</div>
      </div>
      
      {/* Tab Navigation */}
      {showPatientTabs && <div className="flex bg-white border border-primary p-1 shadow-[2px_2px_0px_0px_rgba(85,44,36,1)] w-full lg:w-auto lg:flex-1 min-w-0 overflow-x-auto touch-pan-x scrollbar-hide">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
          <button
            key={num}
            type="button"
            aria-pressed={activeTab === num}
            onClick={() => setActiveTab(num)}
            className={`whitespace-nowrap px-4 py-3 text-sm sm:text-base font-bold font-mono uppercase transition-all shrink-0 text-center min-w-[70px] touch-target ${
              activeTab === num 
                ? 'bg-accent text-primary' 
                : 'text-primary hover:bg-primary/5'
            }`}
          >
            환자 {num}
          </button>
        ))}
        {onResetAll && (
          <button
            onClick={onResetAll}
            className="whitespace-nowrap px-4 py-3 text-sm sm:text-base font-bold font-mono uppercase transition-all shrink-0 text-center min-w-[90px] bg-red-50 text-red-600 hover:bg-red-100 border-l border-primary/20 touch-target"
            title="모든 환자 탭 데이터 초기화"
          >
            전체 리셋
          </button>
        )}
      </div>}

      <div className="text-right hidden lg:block shrink-0">
        <p className="text-xs font-mono opacity-50">현재 접속 시간</p>
        <p className="text-sm font-mono">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
      </div>
    </header>
  );
};
