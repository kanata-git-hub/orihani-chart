import React from 'react';
import { Stethoscope, Loader2, ClipboardList } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

interface Props {
  result?: string;
  isLoading: boolean;
}

export const FollowUpDiagnosisPanel: React.FC<Props> = ({
  result,
  isLoading
}) => {
  return (
    <div className="w-full h-full bg-white text-primary border border-primary/20 p-6 shadow-xl rounded-sm flex flex-col">
      <div className="flex items-center gap-3 mb-4 border-b border-primary/10 pb-2 shrink-0">
        <Stethoscope size={24} className="text-accent" />
        <h3 className="font-serif text-xl font-bold text-primary">3. 감별 진단 및 추천 처방</h3>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-primary space-y-4">
            <Loader2 className="animate-spin" size={48} />
            <p className="font-bold animate-pulse text-lg">최적의 처방 조합을 계산 중입니다...</p>
          </div>
        ) : result ? (
          <div className="bg-bg-input p-4 rounded-lg border border-primary/10 min-h-full">
            <div className="markdown-body font-sans leading-relaxed text-gray-800 break-keep">
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>{result}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-primary/50 text-center space-y-4">
            <ClipboardList size={48} className="opacity-50" />
            <p className="text-lg font-bold">분석이 완료되면<br/>확률이 높은 경우의 수와 처방이 표시됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
};

