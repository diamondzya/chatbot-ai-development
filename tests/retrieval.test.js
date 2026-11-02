import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getIndexMeta,
  loadIndex,
  searchHandbook,
  tokenizeForTest,
} from '../src/services/handbookSearch.js';
import { INDEXED_PRINTED_PAGES } from '../src/services/handbookExtract.js';

function sections(results) {
  return results.map((result) => result.section);
}

test('the handbook index loads with the expected document metadata', async () => {
  const index = await loadIndex();
  const meta = await getIndexMeta();

  assert.equal(meta.title, 'STI High School Student Handbook');
  assert.equal(meta.published, 'July 2026');
  assert.equal(meta.indexedPrintedPages.from, INDEXED_PRINTED_PAGES.from);
  assert.equal(meta.indexedPrintedPages.to, INDEXED_PRINTED_PAGES.to);
  assert.ok(index.chunks.length >= 150, `expected at least 150 chunks, got ${index.chunks.length}`);
  assert.ok(meta.sections >= 120, `expected at least 120 sections, got ${meta.sections}`);
  assert.equal(index.vectors.length, index.chunks.length);
  assert.ok(
    index.chunks.every(
      (chunk) =>
        chunk.page >= INDEXED_PRINTED_PAGES.from && chunk.page <= INDEXED_PRINTED_PAGES.to
    )
  );
  assert.ok(index.chunks.every((chunk) => typeof chunk.text === 'string' && chunk.text.length > 20));
});

test('ID questions retrieve the ID card section and correct printed page', async () => {
  const english = await searchHandbook('What should I do if I forget my school ID?', { topK: 5 });
  assert.ok(
    sections(english.results).slice(0, 3).includes('School Identification (ID) Card'),
    sections(english.results).join(' | ')
  );
  const idChunk = english.results.find((result) => result.section === 'School Identification (ID) Card');
  assert.equal(idChunk.page, 39);
  assert.ok(english.topScore > 0.5);

  const taglish = await searchHandbook('Nakalimutan ko ID ko, makakapasok pa ba ako?', { topK: 5 });
  assert.ok(
    sections(taglish.results).slice(0, 3).includes('School Identification (ID) Card'),
    sections(taglish.results).join(' | ')
  );
});

test('misspelled uniform questions retrieve the uniform rules', async () => {
  const result = await searchHandbook('What are the unifrom requirments?', { topK: 4 });
  assert.equal(result.results[0].section, 'School Uniform');
  assert.equal(result.results[0].page, 40);
});

test('slippers, tardiness, phones, lost items, and discipline reach the right sections', async () => {
  const cases = [
    ['Can I wear slippers to school?', 'School Uniform'],
    ['What are the rules about being late to class?', 'Tardiness'],
    ['Can I use my phone during class?', 'Electronic Gadget Rule'],
    ['What should I do if I lose something at school?', 'Lost and Found Items'],
    ['Where can I find the disciplinary policies?', 'Disciplinary Measures'],
  ];

  for (const [query, expectedSection] of cases) {
    const result = await searchHandbook(query, { topK: 5 });
    assert.ok(
      sections(result.results).slice(0, 3).includes(expectedSection),
      `${query} -> ${sections(result.results).join(' | ')}`
    );
  }
});

test('violence words students use reach the handbook’s own violence rules', async () => {
  // The index contains "assault", "physical injuries", "brawls", "murder",
  // "homicide" — never "kill", "hurt", "stab", or "shoot". Without the synonym
  // bridge these questions matched only on "teacher"/"student" and returned
  // classroom sections instead of the discipline rules.
  const cases = [
    'can I kill my teacher',
    'can I hurt my classmate',
    'what if I stab someone',
    'I want to shoot a student',
  ];
  for (const query of cases) {
    const { results, tokens } = await searchHandbook(query, { topK: 5 });
    assert.ok(
      results.some((result) => /Category C|Category D|Expulsion/i.test(result.section)),
      `"${query}" retrieved ${sections(results).join(', ')} (tokens: ${tokens.join(', ')})`
    );
  }
});

test('student wording for offences, property, money, and wellbeing reaches the right rule', async () => {
  // Each of these uses a word that appears nowhere in the index: the handbook
  // says harassment / theft / damaging / cutting / expulsion / payment / stress
  // / liquor. Without the bridge the question matched on its filler words and
  // returned unrelated sections.
  const cases = [
    ['a teacher harassed me', /Harassment/i],
    ['someone stole my bag', /Category C/i],
    ['I accidentally broke a chair', /Category B|Use of School Facilities/i],
    ['I skipped class', /Category A|Absences|Attendance/i],
    ['can I be expelled', /Expulsion/i],
    ['what if my parents cannot pay on time', /Fees and Payments|Financial Obligations/i],
    ['I feel stressed and overwhelmed', /Guidance/i],
    ['can I drink alcohol inside school', /Smoking, Vaping|Category A/i],
  ];
  for (const [query, expected] of cases) {
    const { results, tokens } = await searchHandbook(query, { topK: 5 });
    assert.ok(
      results.some((result) => expected.test(result.section)),
      `"${query}" retrieved ${sections(results).join(', ')} (tokens: ${tokens.join(', ')})`
    );
  }
});

test('weapon and cheating questions retrieve the discipline chapter', async () => {
  const weapons = await searchHandbook('What does the handbook say about dangerous weapons?', {
    topK: 6,
  });
  const weaponSections = sections(weapons.results);
  assert.ok(
    weaponSections.some((section) => /dangerous weapons/i.test(section)),
    weaponSections.join(' | ')
  );
  const categoryD = weapons.results.find((result) => /Category D/i.test(result.section));
  assert.ok(categoryD, weaponSections.join(' | '));
  assert.ok([57, 58].includes(categoryD.page));

  const cheating = await searchHandbook('What does the handbook say about cheating?', { topK: 6 });
  assert.ok(
    sections(cheating.results).some((section) => /Category A/i.test(section)),
    sections(cheating.results).join(' | ')
  );
});

test('keyword-only retrieval still finds the ID policy', async () => {
  const result = await searchHandbook('What should I do if I forget my school ID?', {
    topK: 5,
    dense: false,
  });
  assert.equal(result.denseUsed, false);
  assert.ok(
    sections(result.results).slice(0, 3).includes('School Identification (ID) Card'),
    sections(result.results).join(' | ')
  );
});

test('empty and nonsense queries do not produce misleading matches', async () => {
  const empty = await searchHandbook('   ', { topK: 5 });
  assert.deepEqual(empty.results, []);

  const nonsense = await searchHandbook('zxqv plorb fizzbuzz', { topK: 5, dense: false });
  assert.equal(nonsense.results.length, 0);
  assert.equal(nonsense.topScore, 0);
});

test('tokenization keeps useful school terms and drops stop words', () => {
  const tokens = tokenizeForTest('What is the policy for my lost ID card?');
  assert.ok(tokens.includes('id'));
  assert.ok(tokens.includes('policy'));
  assert.ok(tokens.includes('lost'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('what'));
});
