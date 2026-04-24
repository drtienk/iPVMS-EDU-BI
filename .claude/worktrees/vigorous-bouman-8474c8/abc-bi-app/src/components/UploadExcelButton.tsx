import { useRef, useState } from 'react';
import { parseExcelFile } from '../parseExcel';
import { saveUpload } from '../dataApi';
import type { NormalizedData, TableName } from '../types';

export interface UploadExcelButtonProps {
  /** Called once after all files are processed. Pass the latest successfully uploaded periodNo to auto-select it. */
  onUploaded?: (latestPeriodNo?: number) => void;
}

/** 依 periodNo 拆出該期的 8 張表資料，每表只含該期 rows；缺的表給 [] */
function splitNormalizedDataByPeriod(normalizedData: NormalizedData, periodNo: number): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  const tableNames = Object.keys(normalizedData) as TableName[];
  for (const tableName of tableNames) {
    const rows = (normalizedData[tableName] ?? []) as { periodNo?: number }[];
    result[tableName] = rows.filter((r) => r.periodNo === periodNo);
  }
  return result;
}

export function UploadExcelButton({ onUploaded }: UploadExcelButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

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

    setMessage(null);
    const errors: { file: string; message: string }[] = [];
    let latestPeriodNo: number | undefined;
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`Uploading ${i + 1}/${files.length}: …`);

      try {
        const { periodNos, sheetStatus, normalizedData } = await parseExcelFile(file);
        if (periodNos.length === 0) {
          errors.push({ file: file.name, message: 'No period(s) found in file' });
          continue;
        }
        for (const periodNo of periodNos) {
          setProgress(`Uploading ${i + 1}/${files.length}: Period ${periodNo} …`);
          const perPeriodData = splitNormalizedDataByPeriod(normalizedData, periodNo);
          await saveUpload(periodNo, sheetStatus, perPeriodData);
          successCount++;
        }
        const maxInFile = Math.max(...periodNos);
        if (latestPeriodNo === undefined || maxInFile > latestPeriodNo) latestPeriodNo = maxInFile;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ file: file.name, message });
        console.error(`Upload failed for ${file.name}:`, err);
      }
    }

    setProgress(null);
    e.target.value = '';

    if (errors.length > 0) {
      const summary = errors.map((e) => `${e.file}: ${e.message}`).join('\n');
      const msg = `${errors.length > 0 ? `Failed: ${errors.length}/${files.length}` : 'Upload failed'}:\n\n${summary}`;
      setMessage({ text: msg, type: 'error' });
      alert(msg);
      console.error('Upload errors:', errors);
    } else if (successCount > 0) {
      setMessage({ text: `✓ Successfully uploaded ${successCount} period(s)`, type: 'success' });
      setTimeout(() => setMessage(null), 3000);
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
        disabled={progress != null}
      >
        📤 Upload Excel
      </button>
      {progress != null && <span className="upload-progress">{progress}</span>}
      {message != null && (
        <span className={`upload-message upload-${message.type}`}>
          {message.text}
        </span>
      )}
    </>
  );
}
