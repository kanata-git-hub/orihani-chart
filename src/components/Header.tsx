import React from 'react';

interface HeaderProps {
  activeTab: number;
  setActiveTab: (tab: number) => void;
  onResetAll?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onResetAll }) => {
  return (
    <header className="mb-6 border-b border-primary pb-4 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
      <div className="flex items-center gap-4 shrink-0">
        <img src="/icon.png" alt="AI 도우미" className="w-16 h-16 object-contain shrink-0" />
        <div className="shrink-0">
          <h1 className="text-4xl font-bold tracking-tight whitespace-nowrap">오리 차트</h1>
          <p className="text-sm font-mono opacity-60 mt-2 whitespace-nowrap">AI 진단 지원 시스템 v1.2</p>
        </div>
      </div>
      
      {/* Tab Navigation */}
      <div className="flex bg-white border border-primary p-1 shadow-[2px_2px_0px_0px_rgba(85,44,36,1)] w-full md:w-auto flex-1 min-w-0 overflow-x-auto touch-pan-x scrollbar-hide">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
          <button
            key={num}
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
      </div>

      <div className="text-right hidden lg:block shrink-0">
        <p className="text-xs font-mono opacity-50">현재 접속 시간</p>
        <p className="text-sm font-mono">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
      </div>
    </header>
  );
};
