import fs from 'node:fs/promises';
import path from 'node:path';
import { config, ensureDataDir } from '../src/config/index.js';
import {
  buildDocumentMeta,
  buildHandbookChunks,
  extractPdfPages,
} from '../src/services/handbookExtract.js';
import { embedTexts } from '../src/services/embeddings.js';

function parseArgs(argv) {
  return {
    lexicalOnly: argv.includes('--lexical-only'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp() {
  console.log(`Usage: npm run index [-- --lexical-only]

Extracts the handbook PDF, creates section-aware chunks with printed page
numbers, and builds the local retrieval index in data/index.json.

Options:
  --lexical-only   Skip embeddings and build a BM25-only index (troubleshooting).
  --help           Show this message.
`);
}

async function atomicWrite(file, contents) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureDataDir();

  try {
    await fs.access(config.handbookPath);
  } catch {
    throw new Error(
      `Handbook not found at:\n  ${config.handbookPath}\n` +
        'Set HANDBOOK_PATH in .env or put the PDF in the project root.'
    );
  }

  console.log(`Reading: ${path.basename(config.handbookPath)}`);
  const { pages, numPages } = await extractPdfPages(config.handbookPath);
  console.log(`Extracted ${numPages} PDF pages.`);

  const meta = buildDocumentMeta({ pdfPath: config.handbookPath, numPages, pages });
  const chunks = buildHandbookChunks(pages);
  if (chunks.length < 40) {
    throw new Error(
      `Only ${chunks.length} chunks were extracted. The PDF layout may have changed; refusing to write a weak index.`
    );
  }

  const sections = new Set(chunks.map((chunk) => chunk.section));
  console.log(`Created ${chunks.length} chunks across ${sections.size} sections.`);

  let vectors = null;
  let embeddingInfo = { provider: 'none', model: null, dimensions: 0 };
  if (!args.lexicalOnly) {
    const provider = config.embeddings.provider;
    const model =
      provider === 'nvidia' ? config.embeddings.nvidiaModel : config.embeddings.localModel;
    console.log(`Generating embeddings with ${provider} / ${model} ...`);
    try {
      vectors = await embedTexts(
        chunks.map((chunk) => chunk.text),
        {
          provider,
          model,
          onProgress: (done, total) => {
            if (done === total || done % 32 === 0) {
              process.stdout.write(`  embedded ${done}/${total}\r`);
            }
          },
        }
      );
      process.stdout.write('\n');
      if (vectors.length !== chunks.length || !Array.isArray(vectors[0])) {
        throw new Error('Embedding count did not match the chunk count.');
      }
      embeddingInfo = {
        provider,
        model,
        dimensions: vectors[0].length,
        normalised: true,
      };
      console.log(`Embeddings ready (${embeddingInfo.dimensions} dimensions).`);
    } catch (error) {
      console.error(`\nEmbedding generation failed: ${error.message}`);
      console.error(
        'The index was not written. Fix the embedding configuration, or run\n' +
          '`npm run index -- --lexical-only` to build a clearly labelled lexical-only index.'
      );
      process.exitCode = 1;
      return;
    }
  } else {
    console.log('Building a lexical-only index (no embeddings).');
  }

  // Record which PDF produced this index so the server can warn when the
  // document changes and citations may have drifted (`/api/health` → stale).
  let sourcePdf = null;
  try {
    const stat = await fs.stat(config.handbookPath);
    sourcePdf = {
      name: path.basename(config.handbookPath),
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
  } catch {
    sourcePdf = null;
  }

  const index = {
    schemaVersion: 1,
    meta: {
      ...meta,
      chunks: chunks.length,
      sections: sections.size,
      sourcePdf,
    },
    embedding: embeddingInfo,
    chunks,
    vectors: vectors
      ? vectors.map((vector) => vector.map((value) => Number(value.toFixed(6))))
      : null,
  };

  const publicHandbook = {
    schemaVersion: 1,
    meta: index.meta,
    embedding: index.embedding,
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      section: chunk.section,
      chapter: chunk.chapter,
      page: chunk.page,
      pageEnd: chunk.pageEnd,
      text: chunk.text,
      keywords: chunk.keywords,
      source: chunk.source,
    })),
  };

  await atomicWrite(config.indexFile, JSON.stringify(index));
  await atomicWrite(config.handbookJsonFile, JSON.stringify(publicHandbook, null, 2));

  console.log(`\nWrote ${path.relative(config.rootDir, config.indexFile)}`);
  console.log(`Wrote ${path.relative(config.rootDir, config.handbookJsonFile)}`);
  console.log(`Document: ${meta.title} (${meta.published})`);
  console.log(`Campus: ${meta.campus}`);
  console.log('Sample chunks:');
  for (const chunk of chunks.slice(0, 3)) {
    console.log(`  [${chunk.section}] p. ${chunk.page}: ${chunk.text.slice(0, 90)}...`);
  }
}

main().catch((error) => {
  console.error(`Indexing failed: ${error.message}`);
  if (process.env.DEBUG) console.error(error);
  process.exitCode = 1;
});
