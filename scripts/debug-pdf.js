// Searches the raw handbook PDF text (every page, before indexing) for a
// pattern. Useful when a question fails and you need to know whether the text
// is in the document at all, and on which printed page — pages outside the
// indexed range (printed pp. 9–61) are reported as "not indexed".
//
// Usage:
//   node scripts/debug-pdf.js "Lupang|Hinirang"
//   node scripts/debug-pdf.js "magiliw" --full     # dump full matching pages
//   node scripts/debug-pdf.js --outline 6          # first 6 lines of every page
import { config } from '../src/config/index.js';
import { extractPdfPages } from '../src/services/handbookExtract.js';

const outlineIndex = process.argv.indexOf('--outline');
const outlineLines = outlineIndex >= 0 ? Number(process.argv[outlineIndex + 1]) || 4 : 0;
const pattern = process.argv[2] || '';
const showFull = process.argv.includes('--full');
if (!pattern && !outlineLines) {
  console.error('Usage: node scripts/debug-pdf.js <regex> [--full] | --outline [n]');
  process.exit(1);
}

const INDEXED_FROM = 9;
const INDEXED_TO = 61;

let re;
try {
  re = new RegExp(pattern, 'i');
} catch (error) {
  console.error(`Invalid regex "${pattern}": ${error.message}`);
  process.exit(1);
}

const { pages, numPages } = await extractPdfPages(config.handbookPath);
console.log(`Scanned ${numPages} PDF pages from ${config.handbookPath}`);
console.log(`Indexed range: printed pp. ${INDEXED_FROM}–${INDEXED_TO}\n`);

if (outlineLines) {
  for (const page of pages) {
    const indexed =
      page.printedPage >= INDEXED_FROM && page.printedPage <= INDEXED_TO
        ? 'indexed'
        : 'NOT INDEXED';
    console.log(
      `=== PDF p. ${page.pdfPage} (printed p. ${page.printedPage}) [${indexed}]` +
        `${page.chapter ? ` — ${page.chapter}` : ''} ===`
    );
    for (const line of page.lines.slice(0, outlineLines)) {
      console.log(`  ${line.slice(0, 160)}`);
    }
  }
  process.exit(0);
}

let hits = 0;
for (const page of pages) {
  const text = page.lines.join(' ');
  if (!re.test(text)) continue;
  hits += 1;
  const indexed =
    page.printedPage >= INDEXED_FROM && page.printedPage <= INDEXED_TO
      ? 'indexed'
      : 'NOT INDEXED';
  console.log(
    `=== PDF p. ${page.pdfPage} (printed p. ${page.printedPage}) [${indexed}]` +
      `${page.chapter ? ` — ${page.chapter}` : ''} ===`
  );
  if (showFull) {
    console.log(page.lines.join('\n'));
  } else {
    for (const line of page.lines) {
      if (re.test(line)) console.log(`  • ${line.slice(0, 220)}`);
    }
  }
  console.log('');
}
console.log(`${hits} page(s) matched.`);
