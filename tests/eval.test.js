import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEval } from '../scripts/eval-retrieval.js';

test('retrieval meets the golden-set thresholds (hit@3 and page accuracy)', async () => {
  const report = await runEval();
  assert.ok(
    report.hitAt3Rate >= report.thresholds.hitAt3Rate,
    `hit@3 ${report.hitAt3Rate} below ${report.thresholds.hitAt3Rate}\n` +
      report.rows
        .filter((row) => !row.hitAt3)
        .map((row) => `- ${row.query} → ${row.top.join(' | ')}`)
        .join('\n')
  );
  assert.ok(
    report.pageAccuracy === null || report.pageAccuracy >= report.thresholds.pageAccuracy,
    `page accuracy ${report.pageAccuracy} below ${report.thresholds.pageAccuracy}`
  );
});
