import { config } from '../config/index.js';
import { cosineSimilarity, embedTexts } from './embeddings.js';
import { getWorkerKv } from './runtime.js';

const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does doing for from had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves po ang ng mga sa at si ni kay para naman lang ba daw kasi yung ito iyon ako ikaw siya kami tayo sila ko mo niya natin ninyo nila may mayroon walang wala hindi oo opo`.split(
    /\s+/
  )
);

const WORD_SYNONYMS = {
  // Filipino / Taglish -> English
  nakalimutan: 'forget',
  nakalimot: 'forget',
  nalimutan: 'forget',
  kalimutan: 'forget',
  makakapasok: 'enter',
  makapasok: 'enter',
  pumasok: 'enter',
  pasok: 'enter',
  papasok: 'enter',
  paaralan: 'school',
  eskwela: 'school',
  eskwelahan: 'school',
  guro: 'teacher',
  titser: 'teacher',
  klase: 'class',
  huli: 'late',
  nahuli: 'late',
  mahuhuli: 'late',
  'nale-late': 'late',
  nawala: 'lost',
  nawawala: 'lost',
  nalaglag: 'lost',
  mawala: 'lost',
  kinumpiska: 'confiscate',
  kinuha: 'confiscate',
  selpon: 'phone',
  cellphone: 'phone',
  cp: 'phone',
  mobile: 'phone',
  telepono: 'phone',
  suot: 'uniform',
  isuot: 'uniform',
  damit: 'uniform',
  uniporme: 'uniform',
  sapatos: 'shoes',
  tsinelas: 'slippers',
  bawal: 'prohibited',
  ipinagbabawal: 'prohibited',
  pwede: 'allowed',
  puwede: 'allowed',
  pwedeng: 'allowed',
  paano: 'how',
  pano: 'how',
  saan: 'where',
  ano: 'what',
  sino: 'who',
  away: 'fight',
  awayin: 'fight',
  binubully: 'bullying',
  nambubully: 'bullying',
  sandata: 'weapon',
  baril: 'gun',
  patalim: 'knife',
  droga: 'drugs',
  suspinde: 'suspension',
  bagsak: 'failed',
  bumagsak: 'failed',
  marka: 'grade',
  bayad: 'payment',
  magbayad: 'payment',
  bayaran: 'payment',
  lumabas: 'leave',
  labas: 'leave',
  saktan: 'assault',
  masaktan: 'assault',
  manakit: 'assault',
  pananakit: 'assault',
  patayin: 'assault',
  pumatay: 'assault',
  pagpatay: 'assault',
  pananakot: 'threat',
  banta: 'threat',
  pagbabanta: 'threat',
  magpakamatay: 'suicide',
  nagpakamatay: 'suicide',
  tulungan: 'help',
  saklolo: 'help',
  emergency: 'emergency',
  aksidente: 'accident',
  sakuna: 'accident',
  // Common English variants
  forget: 'forget',
  forgot: 'forget',
  forgotten: 'forget',
  forgetting: 'forget',
  lose: 'lost',
  loses: 'lost',
  losing: 'lost',
  lost: 'lost',
  mawawala: 'lost',
  bring: 'carry',
  brings: 'carry',
  bringing: 'carry',
  dala: 'carry',
  dalhin: 'carry',
  // Violence: students say "kill", "hurt", "stab", "shoot"; the handbook says
  // "assault", "physical injuries", "brawls", "murder", "homicide". Those
  // student words appear nowhere in the index, so without this bridge a
  // question like "can I kill my teacher" matches only on "teacher" and
  // retrieves teacher and classroom sections instead of the discipline rules.
  kill: 'assault',
  killed: 'assault',
  killing: 'assault',
  murder: 'assault',
  murders: 'assault',
  homicide: 'assault',
  hurt: 'assault',
  hurts: 'assault',
  hurting: 'assault',
  harm: 'assault',
  harms: 'assault',
  harmed: 'assault',
  harmful: 'assault',
  injure: 'assault',
  injured: 'assault',
  injury: 'assault',
  injuries: 'assault',
  attack: 'assault',
  attacks: 'assault',
  attacked: 'assault',
  stab: 'assault',
  stabbed: 'assault',
  stabbing: 'assault',
  shoot: 'assault',
  shoots: 'assault',
  shooting: 'assault',
  punch: 'assault',
  punches: 'assault',
  punched: 'assault',
  slap: 'assault',
  slapped: 'assault',
  beat: 'assault',
  violence: 'assault',
  violent: 'assault',
  threat: 'threat',
  threats: 'threat',
  threaten: 'threat',
  threatened: 'threat',
  threatening: 'threat',
  intimidate: 'threat',
  intimidated: 'threat',
  intimidating: 'threat',
  brawl: 'brawl',
  brawls: 'brawl',
  fighting: 'fight',
  // Same problem in other topics: the handbook's word and the student's word
  // are different and the student's word appears nowhere in the index. Each
  // source below has zero matches; each target already exists in the index, so
  // no rebuild is needed. Words that also occur in the handbook (harass,
  // robbery, damaged, destroyed) are deliberately left alone.
  harassed: 'harassment',
  harassing: 'harassment',
  harasses: 'harassment',
  stole: 'theft',
  steal: 'theft',
  stolen: 'theft',
  thief: 'theft',
  thieves: 'theft',
  rob: 'theft',
  robbed: 'theft',
  broke: 'damaging',
  broken: 'damaging',
  vandal: 'vandalizing',
  vandalize: 'vandalizing',
  vandalized: 'vandalizing',
  expelled: 'expulsion',
  expel: 'expulsion',
  expelling: 'expulsion',
  skipped: 'cutting',
  skip: 'cutting',
  skipping: 'cutting',
  accused: 'accusation',
  accuse: 'accusation',
  accuses: 'accusation',
  punishment: 'sanction',
  punish: 'sanction',
  punished: 'sanction',
  punishing: 'sanction',
  stressed: 'stress',
  stressing: 'stress',
  alcohol: 'liquor',
  beer: 'liquor',
  wine: 'liquor',
  whisky: 'liquor',
  whiskey: 'liquor',
  drunk: 'liquor',
  drunken: 'liquor',
  booze: 'liquor',
  copied: 'cheat',
  pay: 'payment',
  pays: 'payment',
  paying: 'payment',
  paid: 'payment',
  unpaid: 'payment',
  gun: 'weapon',
  guns: 'weapon',
  knife: 'weapon',
  knives: 'weapon',
  firearm: 'weapon',
  firearms: 'weapon',
  explosive: 'weapon',
  explosives: 'weapon',
  weapons: 'weapon',
  deadly: 'weapon',
  drug: 'drugs',
  cheating: 'cheat',
  cheated: 'cheat',
  cheat: 'cheat',
  absent: 'absence',
  suspended: 'suspension',
  confiscated: 'confiscate',
  wear: 'wear',
  wears: 'wear',
  wearing: 'wear',
  disciplinary: 'discipline',
  penalty: 'sanction',
  penalties: 'sanction',
  permitted: 'allowed',
  permission: 'allowed',
  allowed: 'allowed',
  identification: 'id',
  ids: 'id',
  cellphones: 'phone',
  phones: 'phone',
  gadgets: 'gadget',
  unifrom: 'uniform',
  uniforrm: 'uniform',
  requirments: 'requirement',
  requirement: 'requirement',
  requirements: 'requirement',
  tardines: 'tardiness',
  tardy: 'late',
  tardiness: 'late',
  absense: 'absence',
  absences: 'absence',
  attandance: 'attendance',
  discpline: 'discipline',
  discipline: 'discipline',
  weopon: 'weapon',
  weapons: 'weapon',
  bulling: 'bullying',
  bully: 'bullying',
  bullied: 'bullying',
  enrollement: 'enrollment',
  enrolment: 'enrollment',
  payment: 'payment',
  fees: 'payment',
};

const PHRASE_SYNONYMS = [
  [/\b(no|without|walang|wala(?:ng)?)\s+(school\s+)?id\b/gi, ' id '],
  [/\b(forgot|forget|forgotten|nakalimutan|nalimutan)\s+(my|ko|ang|yung|the)?\s*(school\s+)?id\b/gi, ' forget id '],
  [/\b(lost|nawala|nawawala)\s+(my|ko|ang|yung|the)?\s*(school\s+)?id\b/gi, ' lost id '],
  [/\b(lost|nawala|nawawala|lose|losing)\s+(something|item|thing|gamit)\b/gi, ' lost item '],
  [/\b(late|huli|nahuli)\s+(to|sa)?\s*(class|klase)\b/gi, ' late class '],
  [/\b(use|gamit|gumamit)\s+(my|ng|ang)?\s*(phone|cellphone|selpon|cp)\b/gi, ' phone '],
  [/\b(can i|pwede ba|puwede ba|allowed ba)\s+(wear|suot|isuot)\s+(slippers|tsinelas)\b/gi, ' slippers uniform '],
];

const COMMON_CORRECTIONS = new Map(
  Object.entries({
    unifrom: 'uniform',
    uniforrm: 'uniform',
    requirment: 'requirement',
    requirments: 'requirement',
    attandance: 'attendance',
    tardines: 'tardiness',
    schoool: 'school',
    schol: 'school',
    techer: 'teacher',
    discpline: 'discipline',
    weopon: 'weapon',
    bulling: 'bullying',
    enrollement: 'enrollment',
    accomodation: 'accommodation',
    priviledge: 'privilege',
    seperate: 'separate',
    definately: 'definitely',
    recieve: 'receive',
    absense: 'absence',
    excuss: 'excuse',
    libary: 'library',
    laborotory: 'laboratory',
    gradutaion: 'graduation',
    suspention: 'suspension',
    harrassment: 'harassment',
    harrass: 'harass',
    confisticate: 'confiscate',
    confisticated: 'confiscated',
  })
);

function fold(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

function stem(token) {
  if (token.length <= 4) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) return token.slice(0, -1);
  return token;
}

function isOneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return true;
}

export function tokenize(text, { vocabulary = null } = {}) {
  let value = fold(text);
  for (const [pattern, replacement] of PHRASE_SYNONYMS) value = value.replace(pattern, replacement);

  const rawTokens = value
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const tokens = [];
  for (let token of rawTokens) {
    token = token.replace(/^['-]+|['-]+$/g, '');
    if (!token || STOPWORDS.has(token)) continue;
    token = COMMON_CORRECTIONS.get(token) || token;
    token = WORD_SYNONYMS[token] || token;
    if (vocabulary && token.length >= 5 && !vocabulary.has(token)) {
      const first = token[0];
      for (const candidate of vocabulary) {
        if (candidate[0] !== first || Math.abs(candidate.length - token.length) > 1) continue;
        if (isOneEditApart(token, candidate)) {
          token = candidate;
          break;
        }
      }
    }
    token = stem(token);
    if (!STOPWORDS.has(token) && token.length > 1) tokens.push(token);
  }
  return tokens;
}

function buildBm25(chunks) {
  const documents = [];
  const vocabulary = new Set();
  const df = new Map();
  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(
      `${chunk.section} ${chunk.section} ${chunk.keywords || ''} ${chunk.keywords || ''} ${chunk.text}`
    );
    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
      vocabulary.add(token);
    }
    for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    totalLength += tokens.length;
    documents.push({ tokens, tf, length: tokens.length });
  }

  return {
    documents,
    vocabulary,
    df,
    averageLength: documents.length ? totalLength / documents.length : 1,
    total: documents.length,
  };
}

function bm25Scores(queryTokens, bm25) {
  const scores = new Array(bm25.total).fill(0);
  const k1 = 1.4;
  const b = 0.75;
  for (const token of new Set(queryTokens)) {
    const frequency = bm25.df.get(token) || 0;
    if (frequency === 0) continue;
    const idf = Math.log(1 + (bm25.total - frequency + 0.5) / (frequency + 0.5));
    for (let i = 0; i < bm25.total; i += 1) {
      const doc = bm25.documents[i];
      const tf = doc.tf.get(token) || 0;
      if (tf === 0) continue;
      scores[i] +=
        idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / bm25.averageLength)));
    }
  }
  return scores;
}

let cachedIndex = null;
let cachedPromise = null;
let warnedAboutLocalEmbeddings = false;

// The index is a local build artifact. Node reads it from disk; the Worker
// reads it from the HANDBOOK_INDEX KV binding (uploaded with `npm run
// kv:upload`) and keeps it cached in the isolate after the first request.
async function readIndexRaw() {
  if (config.isWorker) {
    const kv = getWorkerKv();
    if (!kv) {
      throw new Error(
        'The handbook index is not configured. Add the HANDBOOK_INDEX KV namespace binding to the Worker.'
      );
    }
    const raw = await kv.get(config.indexKvKey, { type: 'text', cacheTtl: 300 });
    if (typeof raw !== 'string' || raw === '') {
      throw new Error(
        `The handbook index is missing from Cloudflare KV (key "${config.indexKvKey}"). Run \`npm run index\` locally, then \`npm run kv:upload\`.`
      );
    }
    return raw;
  }

  const fs = await import('node:fs/promises');
  try {
    return await fs.readFile(config.indexFile, 'utf8');
  } catch {
    throw new Error(
      'The handbook index is missing. Run `npm run index` before starting the server.'
    );
  }
}

export async function loadIndex({ force = false } = {}) {
  if (force) {
    cachedIndex = null;
    cachedPromise = null;
  }
  if (cachedIndex) return cachedIndex;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const raw = await readIndexRaw();
    const data = JSON.parse(raw);
    if (!Array.isArray(data.chunks) || data.chunks.length === 0) {
      throw new Error('The handbook index is empty or invalid. Run `npm run index` again.');
    }
    if (data.vectors && data.vectors.length !== data.chunks.length) {
      throw new Error('The handbook index has mismatched vectors. Run `npm run index` again.');
    }
    const bm25 = buildBm25(data.chunks);
    cachedIndex = { ...data, bm25 };
    return cachedIndex;
  })();
  try {
    return await cachedPromise;
  } catch (error) {
    cachedPromise = null;
    throw error;
  }
}

export function resetIndexCache() {
  cachedIndex = null;
  cachedPromise = null;
}

function keywordBoost(tokens, chunk) {
  if (!chunk.keywords) return 0;
  const keywordTokens = new Set(tokenize(`${chunk.section} ${chunk.keywords}`));
  let hits = 0;
  for (const token of tokens) if (keywordTokens.has(token)) hits += 1;
  return Math.min(1, hits / 3);
}

function headingBoost(tokens, chunk) {
  const headingTokens = new Set(tokenize(chunk.section));
  let hits = 0;
  for (const token of tokens) if (headingTokens.has(token)) hits += 1;
  if (hits === 0) return 0;
  return Math.min(0.18, hits * 0.06);
}

function topicBoost(tokens, chunk) {
  const set = new Set(tokens);
  const has = (...words) => words.some((word) => set.has(word));
  const section = chunk.section;
  let boost = 0;

  if (has('weapon')) {
    if (section.startsWith('Smoking, Vaping, Prohibited Drugs')) boost += 0.35;
    if (section === 'Major Offenses - Category D') boost += 0.35;
    if (section === 'Expulsion') boost += 0.08;
    if (section === 'Safety and Security') boost += 0.08;
  }
  // Violence against a person: the handbook's on-point rules are the Category C
  // offenses, the Category D crimes, and the Expulsion paragraph.
  if (has('assault', 'murder', 'homicide', 'injury', 'brawl', 'threat', 'attack', 'violence', 'fight')) {
    if (section === 'Major Offenses - Category C') boost += 0.3;
    if (section === 'Major Offenses - Category D') boost += 0.18;
    if (section === 'Expulsion') boost += 0.18;
    if (section === 'Anti-Bullying & Anti-Cyberbullying Policy') boost += 0.12;
    if (section === 'Anti-Hazing Law Policy') boost += 0.06;
  }
  if (has('theft', 'stealing', 'forgery', 'robbery')) {
    if (section === 'Major Offenses - Category C') boost += 0.3;
    if (section === 'Major Offenses - Category B') boost += 0.06;
  }
  if (has('damaging', 'destroying', 'vandalizing', 'vandalism', 'destruction')) {
    if (section === 'Major Offenses - Category B') boost += 0.3;
    if (section === 'Use of School Facilities') boost += 0.1;
    if (section === 'Major Offenses - Category C') boost += 0.06;
  }
  if (has('harassment', 'harass')) {
    if (section === 'Anti-Sexual Harassment Policy') boost += 0.28;
    if (section === 'Major Offenses - Category D') boost += 0.08;
    if (section === 'Gender and Development Policy') boost += 0.06;
  }
  if (has('drugs', 'vape', 'smoking', 'tobacco')) {
    if (section.startsWith('Smoking, Vaping, Prohibited Drugs')) boost += 0.2;
    if (section === 'Random Drug Testing') boost += 0.12;
    if (section === 'Major Offenses - Category D') boost += 0.08;
  }
  if (has('bullying')) {
    if (section === 'Anti-Bullying & Anti-Cyberbullying Policy') boost += 0.25;
    if (section === 'Major Offenses - Category C') boost += 0.1;
  }
  if (has('id')) {
    if (section === 'School Identification (ID) Card') boost += 0.2;
    if (section === 'Procedure for ID Card Replacement') boost += 0.08;
  }
  if (has('uniform', 'slippers', 'attire', 'shoes', 'wear')) {
    if (section === 'School Uniform') boost += 0.22;
    if (section === 'PE Uniform') boost += 0.05;
    if (section === 'Laboratory Uniform (Kitchen Uniform)') boost += 0.05;
  }
  if (has('late')) {
    if (section === 'Tardiness') boost += 0.2;
    if (section === 'Attendance and Punctuality') boost += 0.05;
  }
  if (has('phone', 'gadget')) {
    if (section === 'Electronic Gadget Rule') boost += 0.2;
    if (section === 'Confiscation Policy') boost += 0.05;
  }
  if (has('lost')) {
    if (section === 'Lost and Found Items') boost += 0.2;
    if (section === 'School Identification (ID) Card') boost += 0.05;
  }
  if (has('discipline', 'violation', 'offense', 'sanction')) {
    if (section === 'Student Behavior & Discipline') boost += 0.1;
    if (section === 'Student Discipline') boost += 0.15;
    if (section === 'Discipline Committee') boost += 0.1;
    if (section === 'Procedure for Disciplinary Cases') boost += 0.1;
    if (section === 'Disciplinary Measures') boost += 0.1;
    if (section === 'Offenses') boost += 0.12;
    if (section === 'Categories of Disciplinary Administrative Sanctions') boost += 0.04;
  }
  if (has('cheat')) {
    if (section === 'Major Offenses - Category A') boost += 0.25;
    if (section === 'Academic Obligations of Students') boost += 0.1;
  }
  if (has('absence')) {
    if (section === 'Absences') boost += 0.2;
    if (section === 'Attendance and Punctuality') boost += 0.05;
  }
  if (has('suspension') && has('class', 'typhoon', 'weather', 'pasok')) {
    if (section === 'Suspension of Classes') boost += 0.25;
  }
  if (has('payment')) {
    if (section === 'Fees and Payments') boost += 0.18;
    if (section === 'Refund of Payment') boost += 0.08;
  }
  if (has('refund')) {
    if (section === 'Refund of Payment') boost += 0.25;
  }
  if (has('generative', 'ai', 'chatgpt')) {
    if (section === 'Responsible Use of Generative Artificial Intelligence (GenAI)') boost += 0.22;
  }
  if (has('privacy')) {
    if (section === 'Data Privacy Policy') boost += 0.2;
  }
  if (has('confiscate')) {
    if (section === 'Confiscation Policy') boost += 0.2;
  }
  if (has('leave', 'gate', 'pass')) {
    if (section === 'Leaving the Campus') boost += 0.18;
  } else if (has('campus')) {
    if (section === 'Leaving the Campus') boost += 0.04;
  }
  return Math.min(0.4, boost);
}

export async function searchHandbook(query, { topK = 5, dense = true } = {}) {
  const index = await loadIndex();
  const tokens = tokenize(query, { vocabulary: index.bm25.vocabulary });
  if (tokens.length === 0) {
    return { results: [], tokens, denseUsed: false, warnings: [], totalChunks: index.chunks.length };
  }

  const warnings = [];
  let denseVectors = null;
  let denseUsed = false;

  // Query embeddings must come from the same provider that built the index.
  // Local ONNX models are never loaded in the Worker (far too large for the
  // 128 MB isolate and the free plan's 10 ms CPU budget), so an index built
  // with local embeddings is searched with BM25 keywords there. Rebuilding the
  // index with EMBEDDING_PROVIDER=nvidia enables semantic search in the Worker.
  const denseProvider = index.embedding?.provider || null;
  const denseAvailableOnThisPlatform = !(config.isWorker && denseProvider !== 'nvidia');
  if (!denseAvailableOnThisPlatform && !warnedAboutLocalEmbeddings) {
    warnedAboutLocalEmbeddings = true;
    console.warn(
      JSON.stringify({
        level: 'warn',
        message:
          'The handbook index was built with local embeddings, so the Cloudflare Worker searches with keywords only. Rebuild with EMBEDDING_PROVIDER=nvidia and run `npm run kv:upload` to enable semantic search.',
      })
    );
  }

  if (
    dense &&
    denseAvailableOnThisPlatform &&
    config.features.allowDenseRetrieval &&
    Array.isArray(index.vectors) &&
    index.vectors.length === index.chunks.length
  ) {
    try {
      const [queryVector] = await embedTexts([query], {
        provider: index.embedding.provider,
        model: index.embedding.model,
        query: true,
      });
      if (queryVector && queryVector.length === index.vectors[0]?.length) {
        denseVectors = index.vectors.map((vector) => cosineSimilarity(queryVector, vector));
        denseUsed = true;
      } else {
        warnings.push('The query embedding did not match the index dimensions; using keyword search.');
      }
    } catch (error) {
      warnings.push('Semantic search is temporarily unavailable; using keyword search.');
      if (!config.isProduction) warnings.push(`Embedding error: ${error.message}`);
    }
  }

  const lexical = bm25Scores(tokens, index.bm25);
  const maxLexical = Math.max(...lexical, 0.0001);
  const scored = index.chunks.map((chunk, i) => {
    const lexicalScore = lexical[i] / maxLexical;
    const denseScore = denseVectors ? Math.max(0, denseVectors[i]) : 0;
    const boost = keywordBoost(tokens, chunk);
    const heading = headingBoost(tokens, chunk);
    const topic = topicBoost(tokens, chunk);
    const score = denseUsed
      ? 0.45 * denseScore + 0.45 * lexicalScore + 0.08 * boost + heading + topic
      : 0.85 * lexicalScore + 0.08 * boost + heading + topic;
    return {
      ...chunk,
      score: Number(score.toFixed(4)),
      denseScore: Number(denseScore.toFixed(4)),
      lexicalScore: Number(lexicalScore.toFixed(4)),
      keywordScore: Number(boost.toFixed(4)),
      topicScore: Number(topic.toFixed(4)),
    };
  });

  scored.sort((a, b) => b.score - a.score || a.page - b.page);
  const results = scored.filter((chunk) => chunk.score > 0).slice(0, topK);
  return {
    results,
    tokens,
    denseUsed,
    warnings,
    totalChunks: index.chunks.length,
    topScore: results[0]?.score || 0,
  };
}

export function formatSource(chunk, index) {
  return {
    id: chunk.id,
    section: chunk.section,
    chapter: chunk.chapter,
    page: chunk.page,
    pageEnd: chunk.pageEnd,
    excerpt: chunk.text.length > 700 ? `${chunk.text.slice(0, 700).trim()}…` : chunk.text,
    source: chunk.source || index?.meta?.title || 'STI High School Student Handbook 2026',
  };
}

export async function getIndexMeta() {
  const index = await loadIndex();
  return index.meta;
}

let tocCache = null;

// The table of contents is derived from the indexed chunks, so it always
// matches what retrieval can actually cite.
export async function getTableOfContents() {
  const index = await loadIndex();
  const generatedAt = index.meta?.generatedAt || null;
  if (tocCache && tocCache.generatedAt === generatedAt) return tocCache;

  const chapters = new Map();
  for (const chunk of index.chunks) {
    const page = Number(chunk.page) || 0;
    const pageEnd = Number.isFinite(Number(chunk.pageEnd)) ? Number(chunk.pageEnd) : page;
    const chapterName = chunk.chapter || 'Handbook';
    let chapter = chapters.get(chapterName);
    if (!chapter) {
      chapter = { chapter: chapterName, page, pageEnd, sections: new Map() };
      chapters.set(chapterName, chapter);
    }
    chapter.page = Math.min(chapter.page, page);
    chapter.pageEnd = Math.max(chapter.pageEnd, pageEnd);

    const sectionName = chunk.section || 'Section';
    const existing = chapter.sections.get(sectionName);
    if (existing) {
      existing.page = Math.min(existing.page, page);
      existing.pageEnd = Math.max(existing.pageEnd, pageEnd);
    } else {
      chapter.sections.set(sectionName, { section: sectionName, page, pageEnd });
    }
  }

  tocCache = {
    generatedAt,
    pagesIndexed: index.meta?.indexedPrintedPages || null,
    chapters: [...chapters.values()]
      .map((chapter) => ({
        chapter: chapter.chapter,
        page: chapter.page,
        pageEnd: chapter.pageEnd,
        sections: [...chapter.sections.values()].sort((a, b) => a.page - b.page),
      }))
      .sort((a, b) => a.page - b.page),
  };
  return tocCache;
}

export async function getIndexEmbeddingInfo() {
  const index = await loadIndex();
  return index.embedding;
}

export function tokenizeForTest(text) {
  return tokenize(text);
}
