import React from 'react';
import { Trash2 } from 'lucide-react';
import { FollowUpRecord } from '../../types';

interface FollowUpRecordItemProps {
  record: FollowUpRecord;
  isDeletable: boolean;
  onUpdate: (id: string, field: keyof FollowUpRecord, value: string) => void;
  onRx1Update: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}

export const FollowUpRecordItem: React.FC<FollowUpRecordItemProps> = ({
  record,
  isDeletable,
  onRemove
}) => {
  const prescriptions = [record.rx1, record.rx2, record.rx3].filter(Boolean).join(' + ') || record.prescription;

  return (
    <div className="bg-white border border-primary/30 p-4 relative shadow-sm">
      <div className="absolute top-3 right-3">
        {isDeletable && (
          <button 
            onClick={() => onRemove(record.id)} 
            className="text-red-500 hover:opacity-70 transition-opacity cursor-pointer" 
            title="이 투약 기록 제외하기"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
      <h3 className="font-bold text-accent-dark mb-2 text-lg">{record.period}</h3>
      <div className="mb-2">
        <span className="block text-xs font-bold opacity-70 mb-1">처방명</span>
        <p className="text-sm font-bold text-primary">{prescriptions || '처방 기록 없음'}</p>
      </div>
      <div className="mt-3 bg-primary/5 p-3">
        <span className="block text-xs font-bold opacity-70 mb-1">환자 반응 및 피드백</span>
        <p className="text-sm whitespace-pre-wrap">{record.response || '피드백 없음'}</p>
      </div>
    </div>
  );
};
