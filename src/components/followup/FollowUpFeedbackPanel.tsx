import rehypeSanitize from 'rehype-sanitize';
import { markdownSchema } from '../../services/markdownSafety';
import React from 'react';
import { Loader2, Play, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import type { FollowUpEngine } from '../../types';

interface Props {
  result?: string;
  isLoading: boolean;
  canStart: boolean;
  onStartAnalysis: () => void;
  selectedEngine: FollowUpEngine;
  onSelectEngine: (engine: FollowUpEngine) => void;
  runningEngine: FollowUpEngine | null;
  resultEngine?: FollowUpEngine;
  resultModel?: string;
}

const engineLabel = (engine: FollowUpEngine) => engine === 'gpt-astra' ? 'GPT Astra' : 'Gemini';

export const FollowUpFeedbackPanel: React.FC<Props> = ({
  result,
  isLoading,
  canStart,
  onStartAnalysis,
  selectedEngine,
  onSelectEngine,
  runningEngine,
  resultEngine,
  resultModel
}) => {
  return (
    <div className="w-full h-full bg-white text-primary border border-primary/20 p-6 shadow-xl rounded-sm flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-primary/10 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <img src="/icon.png?v=2" alt="AI 도우미" className="w-10 h-10 object-contain" />
          <h3 className="font-serif text-xl font-bold text-primary">2. 이전 처방 코멘트</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-bold">
          분석 엔진
          <select
            value={selectedEngine}
            onChange={event => onSelectEngine(event.target.value as FollowUpEngine)}
            disabled={isLoading}
            className="rounded border border-primary/30 bg-white px-2 py-2 text-primary disabled:opacity-50"
          >
            <option value="gemini">Gemini</option>
            <option value="gpt-astra">GPT Astra</option>
          </select>
        </label>
        <button
          onClick={onStartAnalysis}
          disabled={!canStart || isLoading}
          className={`px-4 py-2 font-bold flex items-center gap-2 transition-colors cursor-pointer text-sm rounded ${
            canStart && !isLoading ? 'bg-primary text-white hover:bg-primary/90' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="currentColor" />}
          분석 실행
        </button>
        </div>
      </div>

      {!isLoading && resultEngine && (
        <p className="mb-3 text-sm text-primary/70 break-words" role="status">
          현재 결과: {engineLabel(resultEngine)}{resultModel ? ` · ${resultModel}` : ''}
          {selectedEngine !== resultEngine && <span className="block mt-1">{engineLabel(selectedEngine)}로 비교하려면 분석을 다시 실행해주세요.</span>}
        </p>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-primary space-y-4">
            <Loader2 className="animate-spin" size={48} />
            <p className="font-bold animate-pulse text-lg text-center">{engineLabel(runningEngine || selectedEngine)}로 기록을 분석 중입니다...</p>
          </div>
        ) : result ? (
          <div className="bg-bg-input p-4 rounded-lg border border-primary/10 min-h-full">
            <div className="markdown-body font-sans leading-relaxed text-gray-800 break-keep">
              <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]}>{result}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-primary/50 text-center space-y-4">
            <Bot size={48} className="opacity-50" />
            <p className="text-lg font-bold">좌측 정보를 모두 입력하신 후<br/>상단의 [분석 실행] 버튼을 눌러주세요.</p>
          </div>
        )}
      </div>
    </div>
  );
};
