import React from 'react';
import { Trash2 } from 'lucide-react';
import { FollowUpRecord } from '../../types';
import { TextAreaField } from '../common/TextAreaField';

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
  onUpdate,
  onRx1Update,
  onRemove
}) => {
  return (
    <div className="bg-white border border-primary/30 p-4 relative shadow-sm">
      <div className="absolute top-3 right-3">
        {isDeletable && (
          <button 
            onClick={() => onRemove(record.id)} 
            className="text-red-500 hover:opacity-70 transition-opacity cursor-pointer" 
            title="이 투약 기록 삭제"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
      <h3 className="font-bold text-accent-dark mb-2 text-lg">{record.period}</h3>
      <div className="mb-3">
        <label className="block text-sm font-bold opacity-80 mb-1">처방명 (최대 3개 합방)</label>
        <div className="flex gap-2">
          <input
            type="text"
            className="w-1/3 bg-transparent border-b-2 border-primary/30 py-2 outline-none focus:border-primary font-bold transition-colors placeholder:font-normal placeholder:opacity-40 text-sm"
            value={record.rx1 !== undefined ? record.rx1 : (record.prescription || '')}
            onChange={(e) => onRx1Update(record.id, e.target.value)}
            placeholder="처방 1"
          />
          <span className="flex items-center text-primary/30 font-bold px-1">+</span>
          <input
            type="text"
            className="w-1/3 bg-transparent border-b-2 border-primary/30 py-2 outline-none focus:border-primary font-bold transition-colors placeholder:font-normal placeholder:opacity-40 text-sm"
            value={record.rx2 || ''}
            onChange={(e) => onUpdate(record.id, 'rx2', e.target.value)}
            placeholder="처방 2 (선택)"
          />
          <span className="flex items-center text-primary/30 font-bold px-1">+</span>
          <input
            type="text"
            className="w-1/3 bg-transparent border-b-2 border-primary/30 py-2 outline-none focus:border-primary font-bold transition-colors placeholder:font-normal placeholder:opacity-40 text-sm"
            value={record.rx3 || ''}
            onChange={(e) => onUpdate(record.id, 'rx3', e.target.value)}
            placeholder="처방 3 (선택)"
          />
        </div>
      </div>
      <div className="mt-3">
        <TextAreaField 
          label="환자 반응 및 피드백" 
          name={`res-${record.id}`} 
          value={record.response} 
          onChange={(e) => onUpdate(record.id, 'response', e.target.value)} 
          placeholder="예: 가려움증은 줄었으나 속쓰림 호소" 
        />
      </div>
    </div>
  );
};
