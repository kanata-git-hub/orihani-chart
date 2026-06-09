import { useState, useEffect } from 'react';
import { FollowUpData } from '../types';

export const getInitialFollowUpData = (): FollowUpData => ({
  briefing: {
    gender: '무관',
    age: '',
    mainSymptom: '',
    patientPattern: '',
    memo: '',
    records: [{ id: '1', period: '1개월차', prescription: '', rx1: '', rx2: '', rx3: '', response: '' }]
  }
});

export const useFollowUpData = () => {
  const [followUpData, setFollowUpData] = useState<Record<number, FollowUpData>>(() => {
    const savedData = localStorage.getItem('followUpData');
    if (savedData) {
      try {
        return JSON.parse(savedData);
      } catch (e) {
        console.error('Error parsing saved follow-up data:', e);
      }
    }
    return {
      1: getInitialFollowUpData(),
      2: getInitialFollowUpData(),
      3: getInitialFollowUpData(),
      4: getInitialFollowUpData(),
      5: getInitialFollowUpData(),
      6: getInitialFollowUpData(),
      7: getInitialFollowUpData(),
      8: getInitialFollowUpData(),
      9: getInitialFollowUpData(),
      10: getInitialFollowUpData(),
    };
  });

  const [isFollowUpSaved, setIsFollowUpSaved] = useState(false);

  useEffect(() => {
    localStorage.setItem('followUpData', JSON.stringify(followUpData));
    setIsFollowUpSaved(true);
    const timer = setTimeout(() => setIsFollowUpSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [followUpData]);

  const resetFollowUpTab = (tab: number) => {
    setFollowUpData(prev => ({
      ...prev,
      [tab]: getInitialFollowUpData()
    }));
  };

  const resetAllFollowUpTabs = () => {
    setFollowUpData({
      1: getInitialFollowUpData(),
      2: getInitialFollowUpData(),
      3: getInitialFollowUpData(),
      4: getInitialFollowUpData(),
      5: getInitialFollowUpData(),
      6: getInitialFollowUpData(),
      7: getInitialFollowUpData(),
      8: getInitialFollowUpData(),
      9: getInitialFollowUpData(),
      10: getInitialFollowUpData(),
    });
  };

  return { followUpData, setFollowUpData, isFollowUpSaved, resetFollowUpTab, resetAllFollowUpTabs };
};
