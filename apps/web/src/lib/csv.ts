/**
 * CSV for German Excel: semicolon separator, CRLF, UTF-8 BOM.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  const escape = (value: unknown) => {
    const s = String(value ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header, ...rows].map((line) => line.map(escape).join(';'));
  return '﻿' + lines.join('\r\n');
}

export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
