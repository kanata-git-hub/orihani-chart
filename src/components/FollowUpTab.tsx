import React, { useState } from 'react';
import { FollowUpRecord } from '../types';
import { generateFollowUpAnalysis } from '../services/aiService';
import { generateFollowUpInitialPrompt } from '../services/prompts';
import { useFollowUpData } from '../hooks/useFollowUpData';
import { useAuth } from '../contexts/AuthContext';

import { ResetModal } from './ResetModal';
import { ErrorModal } from './ErrorModal';
import { FollowUpForm } from './followup/FollowUpForm';
import { FollowUpFeedbackPanel } from './followup/FollowUpFeedbackPanel';
import { FollowUpDiagnosisPanel } from './followup/FollowUpDiagnosisPanel';

export const FollowUpTab: React.FC<{ activeTab: number }> = ({ activeTab }) => {
  const { followUpData, setFollowUpData, resetFollowUpTab, isFollowUpSaved } = useFollowUpData();
  const { googleAccessToken, reconnectGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const data = followUpData[activeTab];
  const { patientName, gender, age, mainSymptom, patientPattern, memo, records } = data.briefing;

  const updateBriefing = (field: keyof typeof data.briefing, value: any) => {
    setFollowUpData(prev => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        briefing: { ...prev[activeTab].briefing, [field]: value }
      }
    }));
  };

  const handleImportFromSheets = async () => {
    let token = googleAccessToken;
    if (!token) {
      token = await reconnectGoogle();
      if (!token) {
        setErrorMessage("Google 계정 연동에 실패했습니다. 팝업 차단이 되어있지 않은지 확인해주세요.");
        return;
      }
    }

    if (!patientName || !gender) {
      setErrorMessage("이름과 성별을 먼저 입력해주세요.");
      return;
    }

    setIsImporting(true);
    try {
      const response = await fetch('/api/fetch-google-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          name: patientName,
          gender: gender,
          symptoms: mainSymptom
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('googleAccessToken');
          throw new Error('Google 연동 토큰이 만료되었습니다. 다시 버튼을 눌러 연동해주세요.');
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch data');
      }

      const { matches } = await response.json();
      
      if (matches.length === 0) {
        setErrorMessage("조건에 맞는 환자 기록을 찾을 수 없습니다.");
        setIsImporting(false);
        return;
      }

      // Map matched rows to FollowUpRecords
      const newRecords = matches.map((match: any, index: number) => {
        let period = match['현재/총기간'] || `${index + 1}개월차`;
        // if period contains a newline like '현재/\n총기간', we take just string
        period = period.replace('\n', '');

        let rxCombined = match['처방 조합'] || '';
        const rx1 = match['처방'] || '';
        const rx2 = match['처방2'] || '';
        const rx3 = match['처방3'] || '';
        
        const addMed = match['가'] || '';
        const subMed = match['감'] || '';
        
        let mods = '';
        if (addMed || subMed) {
          mods = ' (';
          if (addMed) mods += `가: ${addMed}`;
          if (addMed && subMed) mods += ', ';
          if (subMed) mods += `감: ${subMed}`;
          mods += ')';
        }

        if (rxCombined) {
          if (!rxCombined.includes('가') && !rxCombined.includes('감')) {
            rxCombined += mods;
          }
        } else {
          rxCombined = [rx1, rx2, rx3].filter(Boolean).join(' + ') + mods;
        }
        
        const resDetail = match['효과(자세히)'] || '';
        const resBasic = match['효과'] || '';
        const finalResponse = resDetail ? `${resBasic}: ${resDetail}` : resBasic;

        return {
          id: Date.now().toString() + index,
          period,
          prescription: rxCombined,
          rx1: '',
          rx2: '',
          rx3: '',
          response: finalResponse
        };
      });

      updateBriefing('records', newRecords);
      
      // Auto-fill age if empty
      if (!age && matches[0]['나이']) {
        updateBriefing('age', matches[0]['나이']);
      }

    } catch (error: any) {
      console.error(error);
      setErrorMessage(`데이터 불러오기 실패: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const addRecord = () => {
    const newRecords = [
      ...records, 
      { id: Date.now().toString(), period: `${records.length + 1}개월차`, prescription: '', rx1: '', rx2: '', rx3: '', response: '' }
    ];
    updateBriefing('records', newRecords);
  };

  const updateRecord = (id: string, field: keyof FollowUpRecord, value: string) => {
    const newRecords = records.map(r => r.id === id ? { ...r, [field]: value } : r);
    updateBriefing('records', newRecords);
  };

  const handleRx1Update = (id: string, value: string) => {
    const newRecords = records.map(r => {
      if (r.id === id) {
        return { ...r, rx1: value, prescription: undefined };
      }
      return r;
    });
    updateBriefing('records', newRecords);
  };

  const removeRecord = (id: string) => {
    if (records.length <= 1) return;
    const newRecords = records.filter(r => r.id !== id).map((r, idx) => ({ ...r, period: `${idx + 1}개월차` }));
    updateBriefing('records', newRecords);
  };

  const handleReset = () => {
    setIsResetModalOpen(true);
  };

  const confirmReset = () => {
    resetFollowUpTab(activeTab);
    setIsResetModalOpen(false);
  };

  const handleStartAnalysis = async () => {
    if (!mainSymptom) {
      setErrorMessage("주요 증상을 입력해주세요.");
      return;
    }
    
    setIsLoading(true);
    const initialPrompt = generateFollowUpInitialPrompt(gender, age, mainSymptom, patientPattern, memo, records);
    
    try {
      const responseText = await generateFollowUpAnalysis(initialPrompt);
      
      setFollowUpData(prev => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          analysisResult: responseText
        }
      }));
    } catch (error: any) {
      if (error?.message === "QUOTA_EXCEEDED") {
        setErrorMessage("API 호출 한도(Quota)를 일시적으로 초과했습니다.\n\n시스템이 자동으로 대기 후 재시도했으나 실패했습니다.\n잠시 후 다시 시도해주세요.");
      } else {
        setErrorMessage("분석 중 오류가 발생했습니다.\nAPI 키 설정이나 네트워크 상태를 확인해주세요.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Split the combined AI response into Feedback and Diagnosis blocks
  let feedbackResult = '';
  let diagnosisResult = '';

  if (data.analysisResult) {
    const delimiter = '### 2. 📋 감별 진단 및 추천 처방';
    const parts = data.analysisResult.split(delimiter);
    if (parts.length > 1) {
      feedbackResult = parts[0].replace('### 1. 🤝 이전 처방 코멘트', '').trim();
      diagnosisResult = parts[1].trim();
    } else {
      feedbackResult = data.analysisResult.replace('### 1. 🤝 이전 처방 코멘트', '').trim();
    }
  }

  return (
    <div className="flex flex-col xl:flex-row gap-6 mt-4 min-h-[950px] xl:h-[1100px] items-stretch">
      {/* Column 1: Form */}
      <div className="w-full xl:w-[30%] h-full">
        <FollowUpForm
          briefing={data.briefing}
          isSaved={isFollowUpSaved}
          onReset={handleReset}
          onUpdateBriefing={updateBriefing}
          onAddRecord={addRecord}
          onUpdateRecord={updateRecord}
          onRemoveRecord={removeRecord}
          onRx1Update={handleRx1Update}
          onImportFromSheets={handleImportFromSheets}
          isImporting={isImporting}
        />
      </div>

      {/* Column 2: Feedback Report */}
      <div className="w-full xl:w-[35%] h-full">
        <FollowUpFeedbackPanel 
          result={feedbackResult}
          isLoading={isLoading}
          canStart={!!mainSymptom}
          onStartAnalysis={handleStartAnalysis}
        />
      </div>
      
      {/* Column 3: Diagnosis Report */}
      <div className="w-full xl:w-[35%] h-full">
        <FollowUpDiagnosisPanel
          result={diagnosisResult}
          isLoading={isLoading}
        />
      </div>

      <ResetModal 
        isOpen={isResetModalOpen}
        activeTab={activeTab}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={confirmReset}
        title="처방 재평가 초기화"
        message={`환자 ${activeTab}의 모든 재평가 입력 내용과 기록이 삭제됩니다. 정말 초기화하시겠습니까?\n\n※ 초진 차트 탭의 데이터는 삭제되지 않고 그대로 유지됩니다.`}
      />
      <ErrorModal
        isOpen={!!errorMessage}
        message={errorMessage || ''}
        onClose={() => setErrorMessage(null)}
      />
    </div>
  );
};
