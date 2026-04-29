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
}

export const FollowUpForm: React.FC<FollowUpFormProps> = ({
  briefing,
  isSaved,
  onReset,
  onUpdateBriefing,
  onAddRecord,
  onUpdateRecord,
  onRemoveRecord,
  onRx1Update
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
          <div className="flex gap-4">
            <div className="w-1/2">
              <label className="block text-sm font-bold opacity-80 mb-1">성별</label>
              <div className="flex gap-2">
                {['남성', '여성', '무관'].map((g) => (
                  <button
                    key={g}
                    onClick={() => onUpdateBriefing('gender', g)}
                    className={`flex-1 py-2 text-sm font-bold border border-primary transition-colors cursor-pointer ${
                      (briefing.gender || '무관') === g ? 'bg-accent text-primary' : 'bg-white text-primary'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-1/2">
              <InputField label="나이" name="age" value={briefing.age} onChange={(e) => onUpdateBriefing('age', e.target.value)} placeholder="예: 45세" />
            </div>
          </div>
          <InputField label="주요 증상" name="mainSymptom" value={briefing.mainSymptom} onChange={(e) => onUpdateBriefing('mainSymptom', e.target.value)} placeholder="예: 상체 열감, 불면" />
          <TextAreaField label="환자의 증상/변증" name="patientPattern" value={briefing.patientPattern} onChange={(e) => onUpdateBriefing('patientPattern', e.target.value)} placeholder="예: 식욕부진, 잦은 설사, 피로감 (비위기허 의심)" />
          <TextAreaField label="원장님 초기 판단 메모" name="memo" value={briefing.memo} onChange={(e) => onUpdateBriefing('memo', e.target.value)} placeholder="예: 소화가 덜 되어 습담이 정체된 것으로 보임" />
        </div>
      </section>

      {/* Timeline */}
      <section className="bg-white border border-primary p-6 shadow-[4px_4px_0px_0px_rgba(85,44,36,1)] flex-1 flex flex-col">
        <h2 className="text-xl font-bold mb-4">2. 장기 처방 히스토리</h2>
        <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar mb-4" style={{ maxHeight: '650px' }}>
          {briefing.records.map((record) => (
            <FollowUpRecordItem
              key={record.id}
              record={record}
              isDeletable={briefing.records.length > 1}
              onUpdate={onUpdateRecord}
              onRx1Update={onRx1Update}
              onRemove={onRemoveRecord}
            />
          ))}
        </div>
        <button 
          onClick={onAddRecord}
          className="w-full py-4 border-2 border-dashed border-primary/50 text-primary font-bold hover:bg-primary/5 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer bg-white"
        >
          <div className="flex items-center gap-2">
            <Plus size={20} /> <span className="text-lg">다음 달 투약 기록 추가</span>
          </div>
          <span className="text-xs opacity-60 font-mono">(6개월, 1년 등 무제한 기록 가능)</span>
        </button>
      </section>
    </div>
  );
};
