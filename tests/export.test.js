import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCsv } from '../electron/export.js';

test('CSV export keeps folder order and quotes spreadsheet cells safely', () => {
  const csv = makeCsv([
    { Folder: 'Learning', Position: 1, Title: 'A "quoted", title', URL: 'https://youtube.com/watch?v=abc', Browser: 'Chrome', Watched: 'No', 'High priority': 'Yes', Tags: 'work; study' },
    { Folder: 'Unfiled', Position: 1, Title: '=HYPERLINK("test")', URL: 'https://youtube.com/', Browser: 'Edge', Watched: 'Yes', 'High priority': 'No', Tags: '' }
  ]);
  assert.ok(csv.startsWith('\uFEFF"Folder","Position","Title"'));
  assert.ok(csv.includes('"Learning","1","A ""quoted"", title"'));
  assert.ok(csv.indexOf('"Learning"') < csv.indexOf('"Unfiled"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""test"")"'));
  assert.ok(csv.endsWith('\r\n'));
});
