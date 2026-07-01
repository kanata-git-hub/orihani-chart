import React from 'react';
export const SplashScreen: React.FC = () => {
  return (
    <div 
      className="fixed inset-0 flex flex-col items-center justify-center w-screen h-screen bg-[#fdfbf7] m-0 p-0"
      style={{ zIndex: 9999 }}
    >
      <img src="/icon.png" alt="오리 차트" className="w-[250px] h-[250px] object-contain" />
      <h1 
        className="mt-[24px] text-[32px] font-bold text-[#552c24] mb-0"
        style={{ fontFamily: "'KyoboHandwriting', system-ui, -apple-system, sans-serif" }}
      >
        오리 차트
      </h1>
    </div>
  );
};
