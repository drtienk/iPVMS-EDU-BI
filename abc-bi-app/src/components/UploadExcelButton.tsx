import { useRef, useState } from 'react';
import { parseExcelFile } from '../parseExcel';
import { saveUpload } from '../dataApi';

export interface UploadExcelButtonProps {
  /** Called once after all files are processed. Pass the latest successfully uploaded periodNo to auto-select it. */
  onUploaded?: (latestPeriodNo?: number) => void;
}

export function UploadExcelButton({ onUploaded }: UploadExcelButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (f?.name?.toLowerCase().endsWith('.xlsx')) files.push(f);
    }
    if (files.length === 0) {
      e.target.value = '';
      return;
    }

    const errors: { file: string; message: string }[] = [];
    let latestPeriodNo: number | undefined;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const periodLabel = '…';
      setProgress(`Uploading ${i + 1}/${files.length}: ${periodLabel}`);

      try {
        const { periodNo, sheetStatus, normalizedData } = await parseExcelFile(file);
        setProgress(`Uploading ${i + 1}/${files.length}: ${periodNo} …`);
        await saveUpload(periodNo, sheetStatus, normalizedData as Record<string, unknown[]>);
        latestPeriodNo = periodNo;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ file: file.name, message });
      }
    }

    setProgress(null);
    e.target.value = '';

    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.file}: ${e.message}`).join('\n');
      alert(`Some files failed (${errors.length}/${files.length}):\n\n${summary}`);
    }

    onUploaded?.(latestPeriodNo);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        multiple
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
      {progress != null && <span className="upload-progress">{progress}</span>}
    </>
  );
}
