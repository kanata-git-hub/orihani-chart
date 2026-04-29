import React from 'react';
import personaImg from '../image/persona.png';

interface HeaderProps {
  activeTab: number;
  setActiveTab: (tab: number) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="mb-6 border-b border-primary pb-4 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
      <div className="flex items-center gap-4">
        <img src={personaImg} alt="AI 도우미" className="w-16 h-16 object-contain" />
        <div>
          <h1 className="text-4xl font-bold tracking-tight">오리한의원 차트 AI</h1>
          <p className="text-sm font-mono opacity-60 mt-2">AI 진단 지원 시스템 v1.2</p>
        </div>
      </div>
      
      {/* Tab Navigation */}
      <div className="flex bg-white border border-primary p-1 shadow-[2px_2px_0px_0px_rgba(85,44,36,1)]">
        {[1, 2, 3, 4, 5].map((num) => (
          <button
            key={num}
            onClick={() => setActiveTab(num)}
            className={`px-5 py-2 text-lg font-bold font-mono uppercase transition-all ${
              activeTab === num 
                ? 'bg-accent text-primary' 
                : 'text-primary hover:bg-primary/5'
            }`}
          >
            환자 {num}
          </button>
        ))}
      </div>

      <div className="text-right hidden lg:block">
        <p className="text-xs font-mono opacity-50">현재 접속 시간</p>
        <p className="text-sm font-mono">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
      </div>
    </header>
  );
};
