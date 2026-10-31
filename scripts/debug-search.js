import { searchHandbook } from '../src/services/handbookSearch.js';

const queries = [
  'What should I do if I forget my school ID?',
  'Can I enter the school without my ID?',
  'Nakalimutan ko ID ko, makakapasok pa ba ako?',
  'What are the rules about wearing the proper uniform?',
  'Can I wear slippers to school?',
  'What happens if I am late to class?',
  'What are the rules about tardiness?',
  'Can I use my phone during class?',
  'What should I do if I lose something at school?',
  "Where can I find the school's rules about disciplinary violations?",
  'What happens if I forget to bring my school ID?',
  'What are the unifrom requirments?',
  'Can I bring a knife to school?',
  'Can I bring a gun inside the campus?',
  'What is 1 + 1?',
  'Write me a random poem.',
  'Does the school have a swimming pool?',
  'What does the handbook say about cheating?',
];

for (const query of queries) {
  const result = await searchHandbook(query, { topK: 4 });
  console.log(`\nQ: ${query}`);
  for (const item of result.results) {
    console.log(
      `  ${item.score} | dense ${item.denseScore} | lex ${item.lexicalScore} | kw ${item.keywordScore} | ${item.section} p.${item.page}-${item.pageEnd}`
    );
  }
  if (result.warnings.length) console.log('  warnings:', result.warnings);
}
