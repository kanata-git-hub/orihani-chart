import React, { useState } from 'react';
import { Stethoscope, CheckCircle2, RefreshCw, Send, Loader2, Mic } from 'lucide-react';
import { PatientBriefing } from '../types';
import { InputField } from './common/InputField';
import { TextAreaField } from './common/TextAreaField';
import { fileToBase64 } from '../utils/fileUtils';

interface PatientBriefingFormProps {
  activeTab: number;
  briefing: PatientBriefing;
  isSaved: boolean;
  isLoading: boolean;
  onFieldChange: (name: keyof PatientBriefing, value: any) => void;
  onResetClick: () => void;
  onGenerateClick: (audioData?: { mimeType: string; data: string }) => void;
}

export const PatientBriefingForm: React.FC<PatientBriefingFormProps> = ({
  activeTab,
  briefing,
  isSaved,
  isLoading,
  onFieldChange,
  onResetClick,
  onGenerateClick
}) => {
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    onFieldChange(name as keyof PatientBriefing, value);
  };

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
    }
  };

  const handleGenerate = async () => {
    let audioData = undefined;
    if (audioFile) {
      try {
        audioData = await fileToBase64(audioFile);
      } catch (error) {
        console.error("Failed to read audio file:", error);
      }
    }
    onGenerateClick(audioData);
  };

  return (
    <div className="bg-white border border-primary p-6 shadow-[4px_4px_0px_0px_rgba(85,44,36,1)]">
      <div className="flex items-center justify-between mb-6 border-b border-primary pb-2">
        <div className="flex items-center gap-2">
          <Stethoscope size={18} />
          <h2 className="font-serif text-lg font-bold">환자 정보 (환자 {activeTab})</h2>
        </div>
        <div className="flex items-center gap-4">
          {isSaved && (
            <span className="text-[10px] font-mono text-green-600 flex items-center gap-1 animate-pulse">
              <CheckCircle2 size={10} />
              자동 저장됨
            </span>
          )}
          <button 
            onClick={onResetClick}
            className="flex items-center gap-1 text-lg font-bold font-mono opacity-60 hover:opacity-100 transition-opacity"
            title="현재 환자 정보 초기화"
          >
            <RefreshCw size={12} />
            초기화
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <button
          onClick={handleGenerate}
          disabled={isLoading || (!briefing.mainSymptom && !audioFile)}
          className="w-full bg-accent text-primary font-bold p-4 flex items-center justify-center gap-2 hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg mb-4"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" size={24} />
              <span>데이터 분석 중...</span>
            </>
          ) : (
            <>
              <Send size={24} />
              <span>AI 차트 생성하기</span>
            </>
          )}
        </button>

        <div className="mb-6">
          <label className="block text-base font-bold text-primary mb-1">진료 음성 녹음</label>
          <div className="flex items-center gap-3 bg-bg-input border border-primary p-3">
            <Mic size={20} className="opacity-60" />
            <input
              type="file"
              accept="audio/*"
              onChange={handleAudioChange}
              className="text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:text-sm file:font-bold file:bg-primary file:text-white hover:file:bg-primary/90 cursor-pointer"
            />
          </div>
          <p className="text-sm font-bold opacity-70 mt-2">* 진료 음성을 첨부하시면 대화 내용을 바탕으로 차트가 자동 완성되며, 환자와의 '신뢰 구축 가이드'를 함께 받아보실 수 있습니다.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-base font-bold text-primary mb-1">성별</label>
            <div className="flex gap-2">
              {['남성', '여성', '무관'].map((g) => (
                <button
                  key={g}
                  onClick={() => onFieldChange('gender', g)}
                  className={`flex-1 py-3 text-base font-bold border border-primary transition-colors ${
                    briefing.gender === g ? 'bg-accent text-primary' : 'bg-bg-input text-primary'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <InputField label="나이" name="age" value={briefing.age} onChange={handleInputChange} placeholder="예: 45" type="number" />
        </div>

        <InputField label="주요 증상" name="mainSymptom" value={briefing.mainSymptom} onChange={handleInputChange} placeholder="예: 오른쪽 어깨 통증, 팔 저림" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputField label="발병일 및 기전" name="onsetDate" value={briefing.onsetDate} onChange={handleInputChange} placeholder="예: 2주 전, 무거운 물건 들다가" />
          <div>
            <label className="block text-base font-bold text-primary mb-1">통증 강도</label>
            <select
              name="painIntensity"
              value={briefing.painIntensity}
              onChange={handleInputChange}
              className="w-full bg-bg-input border border-primary p-3 text-base focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">미정 (음성에서 추출)</option>
              {[...Array(11)].map((_, i) => (
                <option key={i} value={i}>{i}/10</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-base font-bold text-primary mb-1">진행 상태</label>
          <div className="flex gap-4">
            {['stable', 'aggravating', 'improving'].map((s) => (
              <label key={s} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={briefing.status === s}
                  onChange={handleInputChange}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-base font-bold">
                  {s === 'stable' ? '변동없음' : s === 'aggravating' ? '악화중' : '호전중'}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <InputField label="악화 요인" name="aggravatingFactors" value={briefing.aggravatingFactors} onChange={handleInputChange} placeholder="예: 고개 숙일 때" />
          <InputField label="압통 부위" name="tendernessPoints" value={briefing.tendernessPoints} onChange={handleInputChange} placeholder="예: 견정, 천종" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <InputField label="관절 가동 범위" name="rom" value={briefing.rom} onChange={handleInputChange} placeholder="예: 굴곡 120도 제한" />
          <InputField label="근력 및 감각 이상" name="strengthSensory" value={briefing.strengthSensory} onChange={handleInputChange} placeholder="예: 우측 악력 저하" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputField label="맥상" name="pulseCondition" value={briefing.pulseCondition} onChange={handleInputChange} placeholder="예: 맥침약, 맥현삭" />
          <InputField label="최근 치료 내역" name="recentTreatment" value={briefing.recentTreatment} onChange={handleInputChange} placeholder="예: 정형외과 물리치료 3회" />
        </div>

        <TextAreaField label="특이 사항" name="specialNotes" value={briefing.specialNotes} onChange={handleInputChange} placeholder="특이사항 입력..." />
        <TextAreaField label="원장님 소견" name="myOpinion" value={briefing.myOpinion} onChange={handleInputChange} placeholder="원장님의 진단 의견이나 의심되는 병명을 입력하세요..." />
      </div>
    </div>
  );
};
