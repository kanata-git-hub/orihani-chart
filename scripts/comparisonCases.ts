import type { PatientBriefing, FollowUpRecord } from '../src/types.ts';

export interface PromptFactories {
  generateChartPrompt: (briefing: PatientBriefing) => string;
  generateFollowUpInitialPrompt: (gender: string, age: string, symptom: string, pattern: string, memo: string, records: FollowUpRecord[]) => string;
}

export interface ComparisonCase {
  id: string;
  kind: 'chart' | 'followup';
  title: string;
  synthetic: true;
  prompt: string;
  reviewPoints: string[];
  audioData?: { mimeType: string; data: string };
}

const briefing = (values: Partial<PatientBriefing>): PatientBriefing => ({
  gender: '', age: '', mainSymptom: '', onsetDate: '', painIntensity: '', status: 'stable',
  aggravatingFactors: '', tendernessPoints: '', rom: '', strengthSensory: '', pulseCondition: '',
  recentTreatment: '', specialNotes: '실제 환자가 아닌 소프트웨어 평가용 합성 사례입니다.', myOpinion: '', ...values,
});

const record = (id: string, period: string, rx1: string, rx2: string, response: string, rx3 = ''): FollowUpRecord =>
  ({ id, period, rx1, rx2, rx3, response });

export const SYNTHETIC_AUDIO_SCRIPT = `평가용으로 만든 가상의 진료 대화입니다. 실제 환자 정보가 아닙니다.
원장: 어디가 불편하세요?
환자: 지난 화요일에 상자를 옮긴 뒤 오른쪽 허리가 아파요. 오늘 통증은 열 점 중 네 점이에요.
원장: 다리가 저리거나 힘이 빠지는 느낌, 대소변 변화가 있었나요?
환자: 그런 건 없어요. 어제보다는 좋아졌는데 오래 앉으면 불편해요.
원장: 허리를 숙이는 범위는 거의 정상이고 오른쪽 허리 근육에 압통이 있네요. 최근 다른 치료는 받으셨나요?
환자: 아직 안 받았어요. 치료가 많이 아플까 걱정돼요.
원장: 걱정되는 부분을 말씀해 주셔서 감사합니다. 불편하면 바로 말씀해 주세요. 강도를 조절하면서 진행하겠습니다.`;

/** All fixtures are invented. Never load patient sheets, browser storage or saved charts here. */
export function createComparisonCases(factories: PromptFactories, audioData?: ComparisonCase['audioData']): ComparisonCase[] {
  const chart = (id: string, title: string, values: Partial<PatientBriefing>, reviewPoints: string[]): ComparisonCase => ({
    id, kind: 'chart', title, synthetic: true, prompt: factories.generateChartPrompt(briefing(values)), reviewPoints,
  });
  const followup = (id: string, title: string, symptom: string, pattern: string, memo: string, records: FollowUpRecord[], reviewPoints: string[]): ComparisonCase => ({
    id, kind: 'followup', title, synthetic: true,
    prompt: factories.generateFollowUpInitialPrompt('여성', '44', symptom, pattern, `평가용 합성 사례이며 실제 환자 정보가 아닙니다. ${memo}`, records),
    reviewPoints,
  });
  const cases: ComparisonCase[] = [
    chart('chart-mild-pain', '초진: 경도 근골격 통증과 기록 보존', {
      gender: '남성', age: '42', mainSymptom: '좌측 전완부 통증', onsetDate: '4일 전 장시간 키보드 작업 뒤', painIntensity: '3',
      status: 'improving', aggravatingFactors: '반복적인 손목 신전', tendernessPoints: '좌측 전완 신전근 부위', rom: '팔꿈치와 손목 전 범위 유지',
      strengthSensory: '좌우 근력 차이와 감각 저하 없음', recentTreatment: '치료받은 적 없음', myOpinion: '직업 관련 반복 사용 가능성. 입력한 검사 결과를 다시 물어보지 않도록.',
    }, ['좌측, 4일, NRS 3, 호전 중, 정상 ROM과 감각을 보존', '이미 확인한 검사를 단순 반복하지 않음', '만성 통증으로 바꾸거나 존재하지 않는 신경학적 이상을 생성하지 않음', '한글 혈명·한글 진단명과 기존 차트 항목 유지']),
    chart('chart-traffic-injury', '초진: 교통사고와 치료 선택 제한', {
      gender: '여성', age: '39', mainSymptom: '교통사고 후 경항부 통증', onsetDate: '3일 전 후방 추돌', painIntensity: '6', status: 'stable',
      rom: '경추 좌회전 40도, 우회전 55도', tendernessPoints: '양측 상부 승모근', strengthSensory: '상지 근력 대칭, 감각 저하 없음',
      recentTreatment: '전일 침 치료 후 일시적 완화', myOpinion: '교통사고 치료 범위 안에서 평가.',
    }, ['교통사고에서 도침을 선택하지 않음', 'ROM 수치와 좌우를 정확히 보존', '가능한 치료에서 구체적 타겟과 짧은 환자 설명 제시']),
    chart('chart-digestion', '초진: 내과 증상과 소화기 내약성', {
      gender: '여성', age: '47', mainSymptom: '식후 더부룩함과 식욕 저하, 피로', onsetDate: '2개월 전부터', status: 'stable',
      aggravatingFactors: '찬 음식과 과식', pulseCondition: '침세', recentTreatment: '없음',
      specialNotes: '평가용 합성 사례. 묽은 변이 주 3회. 과거 지황이 들어간 약 복용 후 더부룩함이 심해졌으나 알레르기는 확인되지 않음.',
      myOpinion: '비위 상태와 실제 복용 반응을 우선하여 쯔무라 기반 합방을 검토.',
    }, ['소화기 내약성을 실제 처방 선택에 반영', '근거가 부족하다는 일반론만 쓰지 않고 구체적 한약 후보 제시', '가감 JSON과 본문 처방 일치', '음성이 없는데 대화 피드백을 지어내지 않음']),
    followup('followup-improving', '재평가: 충분한 호전과 유지 판단', '식후 불편과 식욕 저하', '식후 더부룩함이 주 증상, 차가운 음식을 먹으면 묽은 변',
      '잘 호전되는 치료를 새로움만을 위해 바꾸고 싶지는 않음.', [
        record('1', '첫 14일', '육군자탕', '', '더부룩함 8/10에서 4/10으로 감소. 식욕 회복. 이상반응 없음.'),
        record('2', '다음 14일', '육군자탕', '', '더부룩함 2/10. 식사량 정상에 가까움. 묽은 변은 주 3회에서 1회로 감소. 이상반응 없음.'),
      ], ['유지도 유효한 선택으로 평가', '실제 호전 수치와 주 증상·동반 증상을 구분', '근거 없이 처방을 추가하거나 효과를 보장하지 않음']),
    followup('followup-plateau', '재평가: 부분 반응·정체와 다음 선택', '스트레스 때 심해지는 목 이물감', '목 이물감이 주 증상이고 식후 더부룩함이 동반됨',
      '소화기 반응은 얻었으나 목 이물감은 남아 있음. 아직 시도하지 않은 방향과 기존 유지·변경 요소를 구체적으로 비교하고 싶음.', [
        record('1', '14일', '육군자탕', '', '더부룩함 7/10에서 3/10으로 호전. 목 이물감 7/10으로 변화 없음. 복용 내약성 양호.'),
        record('2', '14일', '육군자탕', '향소산', '더부룩함은 3/10 유지. 목 이물감은 스트레스 때 7/10, 평소 5/10. 두 처방 중 어느 처방의 효과인지는 확인되지 않음.'),
      ], ['첫 문장에 다음 전략과 이유', '동반 증상 호전을 주 증상 해결로 오인하지 않음', '같은 실패 조합을 새 근거 없이 1순위로 반복하지 않음', '연구 부재만으로 구체적 한약 제안을 회피하지 않음']),
    followup('followup-modifiers', '재평가: 최대량 합방·제외·비율 구분', '만성 코막힘과 수양성 비루', '맑은 콧물과 코막힘이 남고 위장 불편은 없음',
      '합방의 중복 약재는 합산하지 않고 최대량으로 구성함. 감: 감초는 완전 제외이고 감: 갈근탕가천궁신이 1/2은 처방 감량임. 정확한 원방별 함량 자료는 입력하지 않았음.', [
        record('1', '14일', '갈근탕가천궁신이(감: 감초)', '소반하가복령탕', '코막힘은 줄었지만 수양성 비루는 남음. 위장 불편은 없음.'),
        record('2', '7일', '갈근탕가천궁신이(감: 감초, 감: 갈근탕가천궁신이 1/2)', '소반하가복령탕', '감량 후 코막힘이 일부 증가. 콧물은 비슷함. 정확한 원인 약재는 확인되지 않음.'),
      ], ['중복 감초의 누적 용량 증가를 가정하지 않음', '완전 제외와 1/2 감량을 구분', '미입력 함량이나 약재별 인과관계를 만들어내지 않음', '수양성 비루 관련 반하 처방 팁 반영']),
    followup('followup-constraints', '재평가: 금기·재고·내약성 제약', '피부 가려움과 식후 불편', '피부 가려움 6/10, 식후 더부룩함이 쉽게 생김',
      '도인·행인은 과거 복용 때 알레르기 반응이 확인되어 제외. 현재 원내에는 사물탕·육군자탕·향소산·귀비탕·당귀작약산 구성을 조제할 수 있음. 그 외 처방의 원료 확보는 확인되지 않음. 증량 대신 내약성과 다음 선택을 비교하고 싶음.', [
        record('1', '14일', '사물탕', '육군자탕', '식후 불편은 7/10에서 3/10으로 감소. 가려움은 6/10으로 변화 없음. 새로운 부작용 없음.'),
      ], ['확인된 알레르기 약재를 돌파구로 재투입하지 않음', '조제 가능성이 미확인인 처방을 즉시 가능한 1순위로 단정하지 않음', '보조 합방만으로 위장 부담이 완전히 해결됐다고 단정하지 않음', '원내 한약 후보와 외부 평가 안내를 구분']),
  ];
  if (audioData) cases.push({
    ...chart('chart-audio', '초진: 합성 진료 음성', {}, ['오른쪽·지난 화요일·NRS 4·호전을 정확히 추출', '감각 저하·근력 저하·대소변 이상 없음이라는 부정 표현 보존', '음성의 실제 대화에 근거한 신뢰 구축 피드백', '화자·질문·대답을 혼동하거나 통증·처방명을 지어내지 않음']),
    audioData,
  });
  return cases;
}
