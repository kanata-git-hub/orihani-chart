import React, { useState } from 'react';
import { FileText, Clipboard, CheckCircle2, Stethoscope, Info, RefreshCw, MessageSquareHeart } from 'lucide-react';
import { AnalysisResult } from '../types';
import { renderWithBold, autoFormatText } from '../utils/formatUtils';

interface AnalysisOutputProps {
  result: AnalysisResult | null;
}

export const AnalysisOutput: React.FC<AnalysisOutputProps> = ({ result }) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = () => {
    if (result?.chartContent) {
      navigator.clipboard.writeText(result.chartContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  if (!result) {
    return (
      <div className="bg-primary text-white border border-primary p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] min-h-[650px] flex flex-col items-center justify-center opacity-30 space-y-6">
        <div className="relative">
          <RefreshCw size={64} className="animate-pulse" />
          <Info size={24} className="absolute -top-2 -right-2" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-sm font-bold">분석 대기 중...</p>
          <p className="text-xs opacity-60">환자 정보를 입력하고 'AI 차트 생성하기'를 클릭하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        {/* 1. Chart Content Box */}
        <div className="bg-primary text-white border border-primary p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] flex flex-col">
          <div className="flex items-center justify-between mb-4 border-b border-white/20 pb-2">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-accent" />
              <h2 className="font-serif text-lg font-bold">차트 내역</h2>
            </div>
            <button 
              onClick={copyToClipboard}
              className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 transition-all duration-300 ${
                isCopied 
                ? 'bg-accent text-primary' 
                : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {isCopied ? (
                <>
                  <CheckCircle2 size={14} />
                  복사 완료!
                </>
              ) : (
                <>
                  <Clipboard size={14} />
                  차트 복사하기
                </>
              )}
            </button>
          </div>
          <div className="font-mono text-base leading-relaxed whitespace-pre-wrap text-white/90">
            {typeof result.chartContent === 'string' 
              ? autoFormatText(result.chartContent)
              : JSON.stringify(result.chartContent, null, 2)}
          </div>
          <div className="mt-6 pt-4 border-t border-white/20 flex items-center gap-2 text-xs font-bold opacity-50">
            <CheckCircle2 size={14} />
            <span>AI가 작성한 초안입니다. 최종 서명 전 반드시 내용을 확인해주세요.</span>
          </div>
        </div>

        {/* 2. AI Diagnostic Guide Box */}
        <div className="bg-white text-primary border border-primary/20 p-6 shadow-xl rounded-sm">
          <div className="flex items-start justify-between mb-4 border-b border-primary/10 pb-2">
            <div className="flex items-center gap-2">
              <Stethoscope size={24} className="text-accent" />
              <h3 className="font-serif text-xl font-bold text-primary">AI 진찰 가이드</h3>
            </div>
            <div className="flex flex-col items-end gap-1.5 ml-4 overflow-hidden">
              {result.matchProbability && (
                <span className="text-base font-sans font-bold bg-accent text-primary px-2 py-1 rounded whitespace-nowrap">
                  {result.assessmentDisease ? `${result.assessmentDisease} (일치 가능성 ${result.matchProbability})` : `일치 가능성 ${result.matchProbability}`}
                </span>
              )}
              {result.matchReason && (
                <span className="text-sm text-primary/80 font-medium truncate w-full text-right">
                  {result.matchReason}
                </span>
              )}
            </div>
          </div>
          <div className="text-lg text-primary leading-relaxed whitespace-pre-wrap font-medium bg-bg-input p-4 rounded-lg border border-primary/10">
            {typeof result.diagnosticGuide === 'string' 
              ? renderWithBold(result.diagnosticGuide)
              : JSON.stringify(result.diagnosticGuide, null, 2)}
          </div>
        </div>

        {/* 3. Treatment Recommendation Box */}
        <div className="bg-white text-primary border border-primary/20 p-6 shadow-xl rounded-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-primary/10 pb-2">
            <Info size={24} className="text-accent" />
            <h3 className="font-serif text-xl font-bold text-primary">추천 치료 및 환자 설득</h3>
            {result.recommendedTreatmentType && (
              <span className="ml-auto text-base font-sans font-bold bg-accent text-primary px-2 py-1 rounded">
                [{result.recommendedTreatmentType} 추천]
              </span>
            )}
          </div>
          <div className="text-lg text-primary leading-relaxed whitespace-pre-wrap font-medium bg-bg-input p-4 rounded-lg border border-primary/10">
            {typeof result.treatmentRecommendation === 'string' 
              ? renderWithBold(result.treatmentRecommendation)
              : JSON.stringify(result.treatmentRecommendation, null, 2)}
          </div>
        </div>
      </div>

      <div className="xl:col-span-1 space-y-6">
        {/* 4. Consultation Feedback Box */}
        {result.consultationFeedback && (
          <div className="bg-white text-primary border border-primary/20 p-6 shadow-xl rounded-sm h-full">
            <div className="flex items-center gap-3 mb-4 border-b border-primary/10 pb-2">
              <img src="/icon.png?v=2" alt="AI 도우미" className="w-10 h-10 object-contain" />
              <h3 className="font-serif text-xl font-bold text-primary">신뢰 구축 가이드</h3>
            </div>
            <div className="text-lg text-primary leading-relaxed whitespace-pre-wrap font-medium bg-bg-input p-4 rounded-lg border border-primary/10">
              {renderWithBold(result.consultationFeedback)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
