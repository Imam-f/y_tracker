export const EXPORT_COLUMNS = ['Folder', 'Position', 'Title', 'URL', 'Browser', 'Duration', 'Watched', 'High priority', 'Tags'];

export function makeCsv(rows) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [EXPORT_COLUMNS, ...rows.map((row) => EXPORT_COLUMNS.map((column) =>
    row && typeof row[column] !== 'object' ? row[column] : ''
  ))].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n';
}
