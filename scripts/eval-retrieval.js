/* ==========================================================================
   Retrieval evaluation harness
   Scores the hybrid retrieval against a small golden set of student
   questions: did the expected section reach the top 1 / top 3, and (where
   known) did it cite the right printed page?

   Usage: npm run eval            (human-readable report)
          npm run eval -- --json  (machine-readable, for CI logs)
   ========================================================================== */

import { pathToFileURL } from 'node:url';
import { searchHandbook } from '../src/services/handbookSearch.js';

export const GOLDEN = [
  { query: 'What should I do if I forget my school ID?', section: /Identification \(ID\) Card/, page: 39 },
  { query: 'Nakalimutan ko ID ko, makakapasok pa ba ako?', section: /Identification \(ID\) Card/, page: 39 },
  { query: 'What are the unifrom requirments?', section: /^School Uniform$/, page: 40 },
  { query: 'Can I wear slippers to school?', section: /School Uniform/ },
  { query: 'What are the rules about being late to class?', section: /Tardiness/, page: 37 },
  { query: 'Can I use my phone during class?', section: /Electronic Gadget Rule/, page: 43 },
  { query: 'What should I do if I lose something at school?', section: /Lost and Found/ },
  { query: 'Where can I find the disciplinary policies?', section: /Disciplinary Measures/ },
  { query: 'can I kill my teacher', section: /Category C|Category D|Expulsion/i },
  { query: 'can I hurt my classmate', section: /Category C|Category D|Expulsion/i },
  { query: 'a teacher harassed me', section: /Harassment/i },
  { query: 'someone stole my bag', section: /Category C/i },
  { query: 'I accidentally broke a chair', section: /Category B|Use of School Facilities/i },
  { query: 'I skipped class', section: /Category A|Absences|Attendance/i },
  { query: 'can I be expelled', section: /Expulsion/i },
  { query: 'what if my parents cannot pay on time', section: /Fees and Payments|Financial Obligations/i },
  { query: 'I feel stressed and overwhelmed', section: /Guidance/i },
  { query: 'can I drink alcohol inside school', section: /Smoking, Vaping|Category A/i },
  { query: 'What does the handbook say about dangerous weapons?', section: /dangerous weapons/i },
  { query: 'What does the handbook say about bullying and harassment?', section: /Bullying|Harassment|Category C/i },
];

export async function runEval() {
  const rows = [];

  for (const entry of GOLDEN) {
    const result = await searchHandbook(entry.query, { topK: 5 });
    const topSections = result.results.map((item) => item.section);
    const hitAt1 = topSections.length > 0 && entry.section.test(topSections[0]);
    const hitAt3 = topSections.slice(0, 3).some((section) => entry.section.test(section));
    const pageOk =
      entry.page === undefined
        ? null
        : result.results
            .slice(0, 3)
            .some((item) => entry.section.test(item.section) && item.page === entry.page);

    rows.push({
      query: entry.query,
      hitAt1,
      hitAt3,
      pageOk,
      top: topSections.slice(0, 3),
      topScore: result.topScore,
    });
  }

  const total = rows.length;
  const at1 = rows.filter((row) => row.hitAt1).length;
  const at3 = rows.filter((row) => row.hitAt3).length;
  const pageRows = rows.filter((row) => row.pageOk !== null);
  const pageHits = pageRows.filter((row) => row.pageOk).length;

  return {
    total,
    hitAt1: at1,
    hitAt3: at3,
    hitAt1Rate: Number((at1 / total).toFixed(3)),
    hitAt3Rate: Number((at3 / total).toFixed(3)),
    pageChecked: pageRows.length,
    pageHits,
    pageAccuracy:
      pageRows.length > 0 ? Number((pageHits / pageRows.length).toFixed(3)) : null,
    // A retrieval regression should fail the build rather than drift quietly.
    thresholds: { hitAt3Rate: 0.9, pageAccuracy: 0.75 },
    passed: at3 / total >= 0.9 && (pageRows.length === 0 || pageHits / pageRows.length >= 0.75),
    rows,
  };
}

async function main() {
  const json = process.argv.includes('--json');
  const report = await runEval();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Retrieval evaluation — STI High School Student Handbook index\n');
    for (const row of report.rows) {
      const mark = row.hitAt3 ? (row.hitAt1 ? ' 1 ' : ' 3 ') : ' ✗ ';
      const page = row.pageOk === null ? '' : row.pageOk ? ' page ✓' : ' page ✗';
      console.log(`${mark}${page}  ${row.query}`);
      if (!row.hitAt3) console.log(`      top: ${row.top.join(' | ')}`);
    }
    console.log(
      `\nhit@1 ${report.hitAt1}/${report.total} (${report.hitAt1Rate})` +
        ` · hit@3 ${report.hitAt3}/${report.total} (${report.hitAt3Rate})` +
        ` · page accuracy ${report.pageHits}/${report.pageChecked}` +
        `${report.pageAccuracy === null ? '' : ` (${report.pageAccuracy})`}`
    );
    console.log(
      report.passed
        ? 'PASS — thresholds: hit@3 ≥ 0.9, page accuracy ≥ 0.75'
        : 'FAIL — retrieval fell below the thresholds'
    );
  }

  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
