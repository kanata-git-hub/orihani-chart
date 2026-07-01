import React from 'react';
import { Plus, RotateCcw, CheckCircle2 } from 'lucide-react';
import { FollowUpBriefing, FollowUpRecord } from '../../types';
import { InputField } from '../common/InputField';
import { TextAreaField } from '../common/TextAreaField';
import { FollowUpRecordItem } from './FollowUpRecordItem';

interface FollowUpFormProps {
  briefing: FollowUpBriefing;
  isSaved: boolean;
  onReset: () => void;
  onUpdateBriefing: (field: keyof FollowUpBriefing, value: any) => void;
  onAddRecord: () => void;
  onUpdateRecord: (id: string, field: keyof FollowUpRecord, value: string) => void;
  onRemoveRecord: (id: string) => void;
  onRx1Update: (id: string, value: string) => void;
  onImportFromSheets?: () => void;
  isImporting?: boolean;
}

export const FollowUpForm: React.FC<FollowUpFormProps> = ({
  briefing,
  isSaved,
  onReset,
  onUpdateBriefing,
  onAddRecord,
  onUpdateRecord,
  onRemoveRecord,
  onRx1Update,
  onImportFromSheets,
  isImporting
}) => {
  return (
    <div className="w-full h-full flex flex-col gap-6">
      {/* Baseline */}
      <section className="bg-white border border-primary p-6 shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] relative">
        <div className="absolute top-4 right-4 flex items-center gap-4">
          {isSaved && (
            <span className="text-[10px] font-mono text-green-600 flex items-center gap-1 animate-pulse">
              <CheckCircle2 size={10} />
              자동 저장됨
            </span>
          )}
          <button 
            onClick={onReset}
            className="flex items-center gap-1 text-sm font-bold opacity-60 hover:opacity-100 hover:text-red-600 transition-all cursor-pointer"
          >
            <RotateCcw size={16} /> 초기화
          </button>
        </div>
        <h2 className="text-xl font-bold mb-4">1. 환자 정보</h2>
        
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <InputField label={<span className="text-[#a52a2a]">성함 (검색용)</span>} name="patientName" value={briefing.patientName || ''} onChange={(e) => onUpdateBriefing('patientName', e.target.value)} placeholder="예: 홍길동" />
            </div>
            <div>
              <label className="block text-sm font-bold mb-1 text-[#a52a2a]">성별 (검색용)</label>
              <div className="flex gap-2">
                {['남', '여'].map((g) => (
                  <button
                    key={g}
                    onClick={() => onUpdateBriefing('gender', g)}
                    className={`flex-1 py-2 text-sm font-bold border border-primary transition-colors cursor-pointer touch-target ${
                      briefing.gender === g ? 'bg-accent text-primary' : 'bg-white text-primary'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <InputField label="나이 (선택, 분석용)" name="age" value={briefing.age} onChange={(e) => onUpdateBriefing('age', e.target.value)} placeholder="예: 45세" />
            </div>
          </div>
          <InputField label={<span className="text-[#a52a2a]">주요 증상 (검색 및 분석용, 선택)</span>} name="mainSymptom" value={briefing.mainSymptom} onChange={(e) => onUpdateBriefing('mainSymptom', e.target.value)} placeholder="예: 어지럼증 (해당 증상이 포함된 기록만 검색, AI 분석에도 활용됨)" />
          <TextAreaField label="환자의 증상/변증 (선택, 분석용)" name="patientPattern" value={briefing.patientPattern} onChange={(e) => onUpdateBriefing('patientPattern', e.target.value)} placeholder="예: 식욕부진, 잦은 설사, 피로감 (비위기허 의심)" />
          <TextAreaField label="원장님 초기 판단 메모 (선택, 분석용)" name="memo" value={briefing.memo} onChange={(e) => onUpdateBriefing('memo', e.target.value)} placeholder="예: 소화가 덜 되어 습담이 정체된 것으로 보임" />
        </div>
        
        {onImportFromSheets && (
          <div className="mt-4 bg-primary/5 p-4 border border-primary">
            <p className="text-xs opacity-70 mb-2">Google Sheets 연동을 통해 과거 처방 기록을 불러올 수 있습니다.</p>
            <button 
              onClick={onImportFromSheets}
              disabled={isImporting}
              className="w-full py-2 bg-primary text-white font-bold text-sm hover:bg-primary-light transition-colors disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
            >
              {isImporting ? '불러오는 중...' : '구글 시트에서 기록 가져오기'}
            </button>
          </div>
        )}
      </section>

      {/* Timeline */}
      <section className="bg-white border border-primary p-6 shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] flex-1 flex flex-col">
        <h2 className="text-xl font-bold mb-4">2. 장기 처방 히스토리</h2>
        <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar mb-4" style={{ maxHeight: '650px' }}>
          {briefing.records.length === 0 ? (
            <div className="text-center py-10 opacity-50 flex flex-col items-center">
              <span className="text-sm">검색된 과거 처방 기록이 없습니다.</span>
              <span className="text-xs mt-1">상단의 '구글 시트에서 기록 가져오기' 버튼을 눌러주세요.</span>
            </div>
          ) : (
            briefing.records.map((record) => (
              <FollowUpRecordItem
                key={record.id}
                record={record}
                isDeletable={true}
                onUpdate={onUpdateRecord}
                onRx1Update={onRx1Update}
                onRemove={onRemoveRecord}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
};
