import { useRef } from 'react';
import { parseExcelFile } from '../parseExcel';
import { saveUpload } from '../dataApi';

export interface UploadExcelButtonProps {
  onUploaded?: () => void;
}

export function UploadExcelButton({ onUploaded }: UploadExcelButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith('.xlsx')) return;
    try {
      const { periodNo, sheetStatus, normalizedData } = await parseExcelFile(file);
      await saveUpload(periodNo, sheetStatus, normalizedData as Record<string, unknown[]>);
      onUploaded?.();
    } catch (err) {
      console.error(err);
      alert('上傳或解析失敗：' + (err instanceof Error ? err.message : String(err)));
    }
    e.target.value = '';
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => inputRef.current?.click()}
      >
        📤 Upload Excel
      </button>
    </>
  );
}
