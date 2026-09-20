import { scopedStorage } from '../accountStorage';
import { auth } from '../services/firebase';
import { useState, useEffect } from 'react';
import { PatientBriefing, PatientData } from '../types';
import { initialBriefing } from '../constants';

export const usePatientData = () => {
  const [storage] = useState(() => scopedStorage(localStorage, auth.currentUser?.uid || null));
  const [activeTab, setActiveTab] = useState<number>(() => {
    const savedTab = storage.getItem('activeTab');
    return savedTab ? parseInt(savedTab, 10) : 1;
  });

  const [patientData, setPatientData] = useState<Record<number, PatientData>>(() => {
    const savedData = storage.getItem('patientData');
    if (savedData) {
      try {
        return JSON.parse(savedData);
      } catch (e) {
        console.error('Error parsing saved patient data:', e);
      }
    }
    return {
      1: { briefing: { ...initialBriefing }, result: null },
      2: { briefing: { ...initialBriefing }, result: null },
      3: { briefing: { ...initialBriefing }, result: null },
      4: { briefing: { ...initialBriefing }, result: null },
      5: { briefing: { ...initialBriefing }, result: null },
      6: { briefing: { ...initialBriefing }, result: null },
      7: { briefing: { ...initialBriefing }, result: null },
      8: { briefing: { ...initialBriefing }, result: null },
      9: { briefing: { ...initialBriefing }, result: null },
      10: { briefing: { ...initialBriefing }, result: null },
    };
  });

  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    storage.setItem('patientData', JSON.stringify(patientData));
    setIsSaved(true);
    const timer = setTimeout(() => setIsSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [patientData]);

  useEffect(() => {
    storage.setItem('activeTab', activeTab.toString());
  }, [activeTab]);

  const updateBriefingField = (tab: number, name: keyof PatientBriefing, value: any) => {
    setPatientData(prev => {
      const currentTab = prev[tab] || { briefing: { ...initialBriefing }, result: null };
      return {
        ...prev,
        [tab]: {
          ...currentTab,
          briefing: { ...currentTab.briefing, [name]: value }
        }
      };
    });
  };

  const updateResult = (tab: number, result: any) => {
    setPatientData(prev => {
      const currentTab = prev[tab] || { briefing: { ...initialBriefing }, result: null };
      return {
        ...prev,
        [tab]: { ...currentTab, result }
      };
    });
  };

  const resetTab = (tab: number) => {
    setPatientData(prev => ({
      ...prev,
      [tab]: { briefing: { ...initialBriefing }, result: null }
    }));
  };

  const resetAllTabs = () => {
    setPatientData({
      1: { briefing: { ...initialBriefing }, result: null },
      2: { briefing: { ...initialBriefing }, result: null },
      3: { briefing: { ...initialBriefing }, result: null },
      4: { briefing: { ...initialBriefing }, result: null },
      5: { briefing: { ...initialBriefing }, result: null },
      6: { briefing: { ...initialBriefing }, result: null },
      7: { briefing: { ...initialBriefing }, result: null },
      8: { briefing: { ...initialBriefing }, result: null },
      9: { briefing: { ...initialBriefing }, result: null },
      10: { briefing: { ...initialBriefing }, result: null },
    });
  };

  return {
    activeTab,
    setActiveTab,
    patientData,
    isSaved,
    updateBriefingField,
    updateResult,
    resetTab,
    resetAllTabs
  };
};
