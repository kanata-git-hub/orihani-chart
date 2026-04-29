export const fileToBase64 = (file: File): Promise<{ mimeType: string; data: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1];
      resolve({ mimeType: file.type, data: base64Data });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};
