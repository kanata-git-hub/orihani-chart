import React from 'react';

export const autoFormatText = (text: string): string => {
  if (!text) return '';

  // 0. Remove markdown bold markers
  let formatted = text.replace(/\*\*/g, '');
  
  // 1. Remove all newlines to fix AI's random line breaks
  formatted = formatted.replace(/\\n/g, ' ').replace(/\n/g, ' ');
  formatted = formatted.replace(/\s+/g, ' ').trim();
  
  // 2. Add newline before bullet points (-, *, •) 
  formatted = formatted.replace(/(.)\s+([-\u2022*]\s)/g, '$1\n$2');
  
  // 3. Add newline before bracket headers, including optional emojis before the bracket
  // \p{Extended_Pictographic} matches standard emojis (🌟, 💡, etc.)
  formatted = formatted.replace(/(.)\s+((?:[\p{Extended_Pictographic}]\s*)*\[[^\]]+\])/gu, '$1\n$2');

  // 4. Remove space between emojis and bracket headers
  formatted = formatted.replace(/([\p{Extended_Pictographic}])\s+(\[[^\]]+\])/gu, '$1$2');

  return formatted;
};

export const renderWithBold = (text: string) => {
  if (!text) return null;
  
  const normalizedText = autoFormatText(text);
  
  // Split by newlines so we can render line breaks properly if whitespace-pre-wrap has issues
  return normalizedText.split('\n').map((line, lineIndex) => {
    const parts = line.split(/(\[.*?\])/g);
    return (
      <React.Fragment key={lineIndex}>
        {parts.map((part, partIndex) => {
          if (part.startsWith('[') && part.endsWith(']')) {
            return <strong key={partIndex} className="font-black text-primary">{part}</strong>;
          }
          return <React.Fragment key={partIndex}>{part}</React.Fragment>;
        })}
        {lineIndex < normalizedText.split('\n').length - 1 && <br />}
      </React.Fragment>
    );
  });
};
