import React from 'react';

interface InputFieldProps {
  label: React.ReactNode;
  name: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
}

export const InputField: React.FC<InputFieldProps> = ({ label, name, value, onChange, placeholder, type = "text" }) => (
  <div>
    <label className="block text-base font-bold text-primary mb-1">{label}</label>
    <input
      type={type}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full bg-bg-input border border-primary p-3 text-base focus:outline-none focus:ring-1 focus:ring-accent"
    />
  </div>
);
