import fs from 'node:fs';
import { config, publicHealthConfig } from '../src/config/index.js';

const provider = publicHealthConfig();
const issues = [];
const notes = [];

console.log(`STI Assist AI v${config.appVersion}`);
console.log(`Node: ${process.version}`);
console.log(`Mode: ${config.features.demoMode ? 'local retrieval demo (not AI)' : 'AI enabled'}`);
console.log(`Provider: ${provider.provider}`);
console.log(`Chat model: ${config.features.demoMode ? 'not active' : provider.chatModel}`);
console.log(`Vision model: ${config.features.demoMode ? 'not active' : provider.visionModel}`);
console.log(
  `Embeddings: ${provider.embeddingProvider} / ${provider.embeddingModel}`
);

if (config.features.demoMode) {
  if (provider.keyWasPlaceholder) {
    notes.push('AI_API_KEY is still a placeholder value. Replace it with a real key to enable AI answers.');
  } else {
    notes.push('No real AI_API_KEY is configured. The app will answer with clearly labelled handbook excerpts.');
  }
}

if (!fs.existsSync(config.handbookPath)) {
  issues.push(
    `Handbook PDF not found at ${config.handbookPath}. Set HANDBOOK_PATH or place the PDF in the project root.`
  );
}

if (!fs.existsSync(config.indexFile)) {
  issues.push('data/index.json is missing. Run `npm run index` before starting the server.');
} else {
  try {
    const index = JSON.parse(fs.readFileSync(config.indexFile, 'utf8'));
    console.log(
      `Index: ${index.chunks?.length || 0} chunks, ${index.meta?.sections || 0} sections, ` +
        `${index.embedding?.provider || 'unknown'} embeddings`
    );
    if (!Array.isArray(index.chunks) || index.chunks.length === 0) {
      issues.push('data/index.json does not contain any chunks. Rebuild it with `npm run index`.');
    }
  } catch (error) {
    issues.push(`data/index.json could not be read: ${error.message}`);
  }
}

for (const note of notes) console.warn(`Note: ${note}`);
for (const issue of issues) console.error(`Problem: ${issue}`);

if (issues.length > 0) {
  console.error(`\nConfiguration check failed with ${issues.length} problem(s).`);
  process.exitCode = 1;
} else {
  console.log('\nConfiguration looks valid.');
}
