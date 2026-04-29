import React from 'react';

export const renderWithBold = (text: string) => {
  if (!text) return null;
  const parts = text.split(/(\[.*?\])/g);
  return parts.map((part, index) => {
    if (part.startsWith('[') && part.endsWith(']')) {
      return <strong key={index} className="font-black text-primary">{part}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};
