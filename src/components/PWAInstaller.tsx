import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstaller: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroidPrompt, setShowAndroidPrompt] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Android Install Prompt
    // Check if event was already captured
    if ((window as any).deferredPWAInstallPrompt) {
      setDeferredPrompt((window as any).deferredPWAInstallPrompt);
      setShowAndroidPrompt(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowAndroidPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // iOS Detection
    const isIos = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };

    const isInStandaloneMode = () => {
      return ('standalone' in window.navigator) && (window.navigator as any).standalone;
    };

    if (isIos() && !isInStandaloneMode()) {
      setShowIosPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowAndroidPrompt(false);
    }
    setDeferredPrompt(null);
  };

  if (isDismissed) return null;

  if (showAndroidPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 bg-white border-2 border-primary p-4 shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] flex items-center justify-between z-50 rounded-lg">
        <div className="flex-1">
          <p className="font-bold text-primary mb-1">앱으로 설치하기</p>
          <p className="text-sm opacity-80 text-primary">바탕화면에서 오리 차트를 바로 실행하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleInstallClick}
            className="px-4 py-2 bg-accent text-primary font-bold border border-primary touch-target whitespace-nowrap"
          >
            설치
          </button>
          <button 
            onClick={() => setIsDismissed(true)}
            className="p-2 text-primary opacity-50 hover:opacity-100 touch-target"
          >
            <X size={20} />
          </button>
        </div>
      </div>
    );
  }

  if (showIosPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 bg-white border-2 border-primary p-4 shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] z-50 rounded-lg">
        <div className="flex justify-between items-start mb-2">
          <p className="font-bold text-primary">앱으로 설치하기 (iOS)</p>
          <button 
            onClick={() => setIsDismissed(true)}
            className="text-primary opacity-50 hover:opacity-100"
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-primary mb-3">아이폰에서 오리 차트를 더 편리하게 사용하려면:</p>
        <ol className="text-sm text-primary space-y-2 list-decimal list-inside bg-primary/5 p-3 rounded-md">
          <li>브라우저 하단의 <b>공유(Share)</b> 버튼을 누릅니다. (가운데 네모 모양의 위로 향한 화살표)</li>
          <li>메뉴를 위로 올려서 <b>'홈 화면에 추가'(Add to Home Screen)</b>를 선택합니다.</li>
        </ol>
      </div>
    );
  }

  return null;
};
