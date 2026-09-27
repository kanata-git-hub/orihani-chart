import { authFetch } from '../authFetch';
import React, { useState } from 'react';
import { FollowUpRecord, FollowUpEngine } from '../types';
import { generateFollowUpAnalysis } from '../services/aiService';
import { generateFollowUpInitialPrompt } from '../services/prompts';
import { useFollowUpData, getInitialFollowUpData } from '../hooks/useFollowUpData';
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
  const [runningEngine, setRunningEngine] = useState<FollowUpEngine | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const data = followUpData[activeTab] || getInitialFollowUpData();
  const selectedEngine = data.selectedEngine === 'gpt-astra' ? 'gpt-astra' : 'gemini';
  const selectEngine = (engine: FollowUpEngine) => {
    setFollowUpData(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], selectedEngine: engine } }));
  };
  const { patientName, gender, age, mainSymptom, patientPattern, memo, records } = data.briefing;

  const updateBriefing = (field: keyof typeof data.briefing, value: any) => {
    setFollowUpData(prev => {
      const currentTab = prev[activeTab] || getInitialFollowUpData();
      return {
        ...prev,
        [activeTab]: {
          ...currentTab,
          briefing: { ...currentTab.briefing, [field]: value }
        }
      };
    });
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
      const response = await authFetch('/api/fetch-google-sheet', {
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
        const rawPeriod = match['현재/총기간'] || match['현재/\n총기간'] || match['현재 / 총기간'] || match['현재/총 기간'] || '';
        let period = rawPeriod ? String(rawPeriod).replace(/\n/g, '') : `${index + 1}회차`;

        const rawDeliveryDate = match['배송일'] || match['배송\n일'] || match['배송 일'] || '';
        const deliveryDate = rawDeliveryDate ? String(rawDeliveryDate).replace(/\n/g, '') : '';

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
          deliveryDate,
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
    
    if (isLoading) return;
    setIsLoading(true);
    setRunningEngine(selectedEngine);
    const initialPrompt = generateFollowUpInitialPrompt(gender, age, mainSymptom, patientPattern, memo, records);
    
    try {
      const result = await generateFollowUpAnalysis(initialPrompt, selectedEngine);
      
      setFollowUpData(prev => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          analysisResult: result.text,
          resultEngine: result.engine,
          resultModel: result.model
        }
      }));
    } catch (error: any) {
      if (error?.message === "QUOTA_EXCEEDED") {
        setErrorMessage("API 호출 한도(Quota)를 일시적으로 초과했습니다.\n\n잠시 후 다시 시도하거나 다른 분석 엔진을 선택해주세요.");
      } else {
        const messages: Record<string, string> = {
          OPENAI_NOT_CONFIGURED: '오리차트 서버에 OpenAI API 키가 아직 연결되지 않았습니다. 서버의 OPENAI_API_KEY 설정이 필요합니다.',
          OPENAI_ACCESS_DENIED: 'OpenAI API 키 또는 GPT Astra 사용 권한을 확인해주세요.',
          ASTRA_UNAVAILABLE: '현재 OpenAI 계정에서 GPT Astra 모델을 사용할 수 없습니다.',
          GEMINI_NOT_CONFIGURED: '오리차트 서버에 Gemini API 키가 설정되지 않았습니다.',
          ANALYSIS_TIMEOUT: '분석 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
          INCOMPLETE_AI_RESPONSE: '분석 응답이 끝까지 생성되지 않았습니다. 기존 결과는 유지되며, 다시 실행할 수 있습니다.',
          EMPTY_AI_RESPONSE: '분석 결과가 비어 있습니다. 다시 실행해주세요.',
          AI_REFUSAL: '선택한 AI가 이 요청에 대한 분석을 제공하지 않았습니다.',
          INVALID_AI_RESPONSE: '분석 응답을 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.',
        };
        setErrorMessage(messages[error?.message] || '선택한 엔진의 분석에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setIsLoading(false);
      setRunningEngine(null);
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
          selectedEngine={selectedEngine}
          onSelectEngine={selectEngine}
          runningEngine={runningEngine}
          resultEngine={data.analysisResult ? (data.resultEngine || 'gemini') : undefined}
          resultModel={data.resultModel}
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
