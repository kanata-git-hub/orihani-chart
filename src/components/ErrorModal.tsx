import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorModalProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({ 
  isOpen, 
  message,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white border-2 border-red-500 p-6 max-w-sm w-full shadow-[8px_8px_0px_0px_rgba(239,68,68,1)] animate-in fade-in zoom-in duration-200 relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-red-500 hover:opacity-70 transition-opacity"
        >
          <X size={20} />
        </button>
        <div className="flex items-center gap-3 mb-4 text-red-600">
          <AlertCircle size={24} />
          <h3 className="font-serif text-xl font-bold">안내사항</h3>
        </div>
        <p className="text-base mb-6 opacity-90 leading-relaxed whitespace-pre-wrap">
          {message}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-mono font-bold uppercase bg-red-50 text-red-600 border border-red-500 hover:bg-red-100 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
