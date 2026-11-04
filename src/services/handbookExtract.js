import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { HANDBOOK_HEADINGS, SECTION_KEYWORDS } from '../config/handbook.js';

const CHAPTERS = [
  'GENERAL INFORMATION',
  'ACADEMIC POLICIES & PROCEDURES',
  'STUDENT DEVELOPMENT & SERVICES',
  'STUDENT BEHAVIOR & DISCIPLINE',
  'MISCELLANEOUS PROVISIONS',
  'APPENDICES',
];

const CHAPTER_TITLES = {
  'GENERAL INFORMATION': 'General Information',
  'ACADEMIC POLICIES & PROCEDURES': 'Academic Policies & Procedures',
  'STUDENT DEVELOPMENT & SERVICES': 'Student Development & Services',
  'STUDENT BEHAVIOR & DISCIPLINE': 'Student Behavior & Discipline',
  'MISCELLANEOUS PROVISIONS': 'Miscellaneous Provisions',
  APPENDICES: 'Appendices',
};

const RUNNING_HEADER = new RegExp(
  `^(${CHAPTERS.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s+\\d{1,3})?$`,
  'i'
);

function normaliseHeading(value) {
  return String(value || '')
    .replace(/[’‘]/g, "'")
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADING_LOOKUP = new Map(
  HANDBOOK_HEADINGS.map((heading) => [normaliseHeading(heading), heading])
);

function cleanLine(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function pageTextItemsToLines(items) {
  let text = '';
  for (const item of items) {
    text += item.str || '';
    text += item.hasEOL ? '\n' : ' ';
  }
  return text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

function detectChapter(lines) {
  for (const line of lines.slice(0, 3)) {
    const match = line.match(RUNNING_HEADER);
    if (match) {
      const key = match[1].toUpperCase();
      if (CHAPTER_TITLES[key]) return CHAPTER_TITLES[key];
    }
  }
  return null;
}

function stripPageFurniture(lines) {
  return lines.filter((line) => {
    if (/^\d{1,3}$/.test(line)) return false;
    if (RUNNING_HEADER.test(line)) return false;
    if (/^STI STUDENT HANDBOOK\s*\|\s*HIGH SCHOOL$/i.test(line)) return false;
    if (/^PUBLISHED\s+[A-Z]+\s+\d{4}$/i.test(line)) return false;
    return true;
  });
}

function findHeading(lines, startIndex, maxLines = 3) {
  for (let count = maxLines; count >= 1; count -= 1) {
    const parts = lines.slice(startIndex, startIndex + count);
    if (parts.length !== count) continue;
    const candidate = parts.join(' ');
    const normalized = normaliseHeading(candidate);
    if (HEADING_LOOKUP.has(normalized)) {
      return { heading: HEADING_LOOKUP.get(normalized), consumed: count };
    }
  }
  return null;
}

const LIST_START =
  /^(?:[a-z]\.|(?:\d{1,2})\.|•|First offense|Second offense|Third offense|Suspension from class|Preventive Suspension|Suspension|Exclusion|Expulsion)\b/i;

function paragraphsFromLines(lines) {
  const paragraphs = [];
  let current = null;

  const flush = () => {
    if (current && current.text.trim()) {
      paragraphs.push({ text: current.text.trim(), page: current.page });
    }
    current = null;
  };

  for (const { text, page } of lines) {
    if (!text) continue;
    const startsList = LIST_START.test(text);
    if (!current || startsList) {
      flush();
      current = { text, page };
    } else {
      current.text += ` ${text}`;
    }
  }
  flush();
  return paragraphs;
}

function splitLongParagraph(paragraph, maxChars) {
  if (paragraph.text.length <= maxChars) return [paragraph];
  const sentences = paragraph.text.match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g) || [paragraph.text];
  const pieces = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      pieces.push({ text: current.trim(), page: paragraph.page });
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) pieces.push({ text: current.trim(), page: paragraph.page });
  return pieces;
}

function buildSectionChunks(section, { maxChars = 1100, minChars = 40 } = {}) {
  const paragraphs = section.paragraphs.flatMap((p) => splitLongParagraph(p, maxChars));
  if (paragraphs.length === 0) return [];

  const chunks = [];
  let bucket = [];
  let length = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const text = bucket.map((p) => p.text).join('\n\n').trim();
    if (text.length < minChars && chunks.length > 0) {
      chunks[chunks.length - 1].text += `\n\n${text}`;
      chunks[chunks.length - 1].pageEnd = Math.max(
        chunks[chunks.length - 1].pageEnd,
        bucket[bucket.length - 1].page
      );
    } else if (text) {
      const firstPage = Math.min(...bucket.map((p) => p.page));
      const lastPage = Math.max(...bucket.map((p) => p.page));
      chunks.push({
        section: section.heading,
        chapter: section.chapter,
        page: firstPage,
        pageEnd: lastPage,
        text,
      });
    }
    bucket = [];
    length = 0;
  };

  for (const paragraph of paragraphs) {
    if (bucket.length > 0 && length + paragraph.text.length > maxChars) {
      const overlap = bucket.length > 1 ? bucket[bucket.length - 1] : null;
      flush();
      if (overlap && overlap.text.length < 320) {
        bucket = [overlap];
        length = overlap.text.length;
      }
    }
    bucket.push(paragraph);
    length += paragraph.text.length;
  }
  flush();
  return chunks;
}

function slugify(value) {
  return normaliseHeading(value).replace(/\s+/g, '-').slice(0, 48) || 'section';
}

export async function extractPdfPages(pdfPath) {
  const fs = await import('node:fs/promises');
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  const pages = [];
  for (let pdfPage = 1; pdfPage <= numPages; pdfPage += 1) {
    const page = await doc.getPage(pdfPage);
    const content = await page.getTextContent();
    const rawLines = pageTextItemsToLines(content.items);
    const chapter = detectChapter(rawLines);
    const lines = stripPageFurniture(rawLines);
    pages.push({
      pdfPage,
      printedPage: pdfPage - 1,
      chapter,
      lines,
    });
  }
  await loadingTask.destroy();
  return { pages, numPages };
}

// Printed pages that carry indexable content. The appendices with real text
// (A — Lupang Hinirang, B — Panunumpa, D — STI Hymn, printed pp. 63–65) are
// included; Appendix E (uniform illustrations), F (a blank gate-pass form),
// and G (a signature form) are image-only or forms and would only add noise.
export const INDEXED_PRINTED_PAGES = Object.freeze({ from: 9, to: 65 });

export function buildHandbookChunks(
  pages,
  { firstPrintedPage = INDEXED_PRINTED_PAGES.from, lastPrintedPage = INDEXED_PRINTED_PAGES.to } = {}
) {
  const dividerPages = new Set([8, 16, 31, 36, 59, 62]);
  const chunks = [];
  let currentChapter = 'General Information';
  let currentSection = null;
  let sectionNumber = 0;

  const flush = () => {
    if (!currentSection || currentSection.paragraphs.length === 0) {
      currentSection = null;
      return;
    }
    sectionNumber += 1;
    const sectionChunks = buildSectionChunks(currentSection);
    for (const [index, chunk] of sectionChunks.entries()) {
      const id = `${chunk.page}-${slugify(chunk.section)}-${sectionNumber}-${index + 1}`;
      chunks.push({
        id,
        ...chunk,
        keywords: SECTION_KEYWORDS[chunk.section] || '',
        source: 'STI High School Student Handbook 2026',
      });
    }
    currentSection = null;
  };

  for (const page of pages) {
    if (page.printedPage < firstPrintedPage || page.printedPage > lastPrintedPage) continue;
    if (dividerPages.has(page.printedPage)) continue;
    if (page.chapter && page.chapter !== currentChapter) {
      flush();
      currentChapter = page.chapter;
    } else if (page.chapter) {
      currentChapter = page.chapter;
    }

    const lines = page.lines.map((text) => ({ text, page: page.printedPage }));
    let index = 0;
    while (index < lines.length) {
      const match = findHeading(
        lines.map((line) => line.text),
        index
      );
      if (match) {
        flush();
        currentSection = {
          heading: match.heading,
          chapter: currentChapter,
          paragraphs: [],
        };
        index += match.consumed;
        continue;
      }
      if (!currentSection) {
        currentSection = {
          heading: currentChapter,
          chapter: currentChapter,
          paragraphs: [],
        };
      }
      currentSection.paragraphs.push(lines[index]);
      index += 1;
    }
  }
  flush();

  return chunks;
}

function stableId(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function buildDocumentMeta({ pdfPath, numPages, pages }) {
  const publication = pages
    .flatMap((page) => page.lines)
    .map((line) => line.match(/^PUBLISHED\s+([A-Z]+\s+\d{4})$/i))
    .find(Boolean);

  return {
    title: 'STI High School Student Handbook',
    edition: 'High School',
    published: publication ? publication[1] : 'July 2026',
    version: 'No separate version number printed',
    campus: 'Not specified in the document',
    applicability:
      'The handbook states that it applies to all students, both returning and newly enrolled, unless a specific policy states otherwise.',
    sourceFile: path.basename(pdfPath),
    pdfPages: numPages,
    indexedPrintedPages: {
      from: INDEXED_PRINTED_PAGES.from,
      to: INDEXED_PRINTED_PAGES.to,
    },
    pageOffsetNote: 'Printed page numbers are one less than the PDF page numbers.',
    officialStatus:
      'Unofficial prototype. STI Assist AI is not an official STI service unless formally authorized.',
    generatedAt: new Date().toISOString(),
    documentHash: stableId(`${pdfPath}:${numPages}`),
  };
}
