export interface PatientBriefing {
  gender: string;
  age: string;
  mainSymptom: string;
  onsetDate: string;
  painIntensity: string;
  status: 'aggravating' | 'improving' | 'stable';
  aggravatingFactors: string;
  tendernessPoints: string;
  rom: string;
  strengthSensory: string;
  pulseCondition: string;
  recentTreatment: string;
  specialNotes: string;
  myOpinion: string;
}

export interface AnalysisResult {
  chartContent: string;
  diagnosticGuide: string;
  matchProbability?: string;
  matchReason?: string;
  assessmentDisease?: string;
  treatmentRecommendation: string;
  recommendedTreatmentType?: string;
  consultationFeedback?: string;
}

export interface FollowUpRecord {
  id: string;
  period: string; // e.g., "1개월차"
  prescription?: string; // legacy e.g., "소풍산+계지가작약탕+시호계지탕"
  rx1?: string;
  rx2?: string;
  rx3?: string;
  response: string; // e.g., "반응..."
}

export interface FollowUpBriefing {
  patientName: string;
  gender: string;
  age: string;
  mainSymptom: string;
  patientPattern: string; // 환자의 증상/변증
  memo: string; // 원장님 초기 판단 메모
  records: FollowUpRecord[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface FollowUpData {
  briefing: FollowUpBriefing;
  analysisResult?: string;
}

export interface PatientData {
  briefing: PatientBriefing;
  result: AnalysisResult | null;
}
