import React from 'react';

interface TextAreaFieldProps {
  label: React.ReactNode;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
}

export const TextAreaField: React.FC<TextAreaFieldProps> = ({ label, name, value, onChange, placeholder, rows = 2 }) => (
  <div>
    <label className="block text-base font-bold text-primary mb-1">{label}</label>
    <textarea
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-bg-input border border-primary p-3 text-base focus:outline-none focus:ring-1 focus:ring-accent resize-none"
    />
  </div>
);
