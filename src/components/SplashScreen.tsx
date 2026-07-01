import React from 'react';
import personaImg from '../image/persona.png';

export const SplashScreen: React.FC = () => {
  return (
    <div 
      className="fixed inset-0 flex flex-col items-center justify-center w-screen h-screen bg-[#ffffff] m-0 p-0"
      style={{ zIndex: 9999 }}
    >
      <img src={personaImg} alt="오리 차트" className="w-[250px] h-[250px] object-contain" />
      <h1 
        className="mt-[24px] text-[32px] font-bold text-[#1a1a1a] mb-0"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        오리 차트
      </h1>
    </div>
  );
};
