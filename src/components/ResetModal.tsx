import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ResetModalProps {
  isOpen: boolean;
  activeTab: number;
  onClose: () => void;
  onConfirm: () => void;
  message?: string;
  title?: string;
}

export const ResetModal: React.FC<ResetModalProps> = ({ 
  isOpen, 
  activeTab, 
  onClose, 
  onConfirm,
  message,
  title = "초기화 확인"
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border-2 border-primary p-6 max-w-sm w-full shadow-[8px_8px_0px_0px_rgba(85,44,36,1)] animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4 text-primary">
          <AlertCircle size={24} />
          <h3 className="font-serif text-xl font-bold">{title}</h3>
        </div>
        <p className="text-base mb-6 opacity-80">
          {message || `환자 ${activeTab}의 모든 입력 내용과 분석 결과가 삭제됩니다. 정말 초기화하시겠습니까?`}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-mono font-bold uppercase border border-primary hover:bg-primary/5 transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 text-sm font-mono font-bold uppercase bg-accent text-primary hover:bg-accent-hover transition-colors"
          >
            초기화 실행
          </button>
        </div>
      </div>
    </div>
  );
};
