import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { SUGGESTED_QUESTIONS } from '../config/handbook.js';
import { HttpError } from '../errors.js';
import { analyseImage, chatCompletion, ProviderError, streamChatCompletion } from './aiProvider.js';
import { getAttachment } from './attachments.js';
import { isUnansweredAnswer, recordUnansweredQuestion } from './gapLog.js';
import { getIndexMeta, searchHandbook, tokenize } from './handbookSearch.js';
import { formatPageRange, buildMessages } from './promptBuilder.js';
import { GUIDE_RESPONSES } from './safetyFilter.js';
import { analyseConversation } from './conversationContext.js';

const MIN_SOURCE_SCORE = 0.2;
const MAX_MODEL_SOURCES = 5;
// Every source given to the model must also appear as a source card. A lower
// display cap lets the model cite a page the student cannot open, and the
// citation check will not flag it because it verifies against the sources the
// model actually received.
const MAX_DISPLAY_SOURCES = MAX_MODEL_SOURCES;

const RELATED_QUERIES = {
  weapon:
    'carrying or possession of firearms deadly weapons explosives within and outside school premises major offense Category D',
  violence: 'fighting assault threats bullying harassment major offense discipline',
  cheating: 'cheating examination major offense academic honesty',
  gadget: 'electronic gadget rule mobile phones laptops tablets smart watches confiscation policy',
};

const RELATED_SECTION_PATTERNS = {
  weapon: /weapon|Category D|Expulsion/i,
  violence: /bullying|Category C|hazing|harassment|discipline/i,
  cheating: /Category A|cheating|academic obligations|generative/i,
  gadget: /gadget|confiscation|Category A/i,
};

const IMAGE_REFERENCE =
  /\b(?:image|picture|pic|photo|screenshot|screen shot|notice|announcement|document|paper|sign|poster|text|say|says|read|translate|summari[sz]e|this|attached|uploaded|shown)\b/i;

function truncate(text, max) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}…`;
}

function uniqueParagraphs(texts) {
  const seen = new Set();
  const paragraphs = [];
  for (const text of texts) {
    for (const part of String(text || '').split(/\n{2,}/)) {
      const value = part.replace(/\s+/g, ' ').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      paragraphs.push(value);
    }
  }
  return paragraphs.join('\n\n');
}

function mergeSources(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.section}|${result.page}|${result.pageEnd}`;
    const existing = groups.get(key);
    if (existing) {
      existing.texts.push(result.text);
    } else {
      groups.set(key, {
        id: result.id,
        section: result.section,
        chapter: result.chapter,
        page: result.page,
        pageEnd: result.pageEnd,
        texts: [result.text],
        source: result.source || 'STI High School Student Handbook 2026',
      });
    }
  }
  return [...groups.values()].slice(0, MAX_DISPLAY_SOURCES).map((group) => ({
    id: group.id,
    section: group.section,
    chapter: group.chapter,
    page: group.page,
    pageEnd: group.pageEnd,
    // The handbook's printed pages are one less than its PDF pages. The client
    // uses this to deep-link the source card to the right page in the PDF.
    pdfPage: Number.isFinite(Number(group.page))
      ? Number(group.page) + config.handbookPdf.pdfPageOffset
      : null,
    excerpt: truncate(uniqueParagraphs(group.texts), 900),
    source: group.source,
  }));
}

function selectSources(results) {
  return results
    .filter((result) => Number(result.score) >= MIN_SOURCE_SCORE)
    .slice(0, MAX_MODEL_SOURCES);
}

function confidenceFor(retrieval) {
  const topScore = Number(retrieval?.topScore || 0);
  const count = retrieval?.results?.length || 0;
  if (count === 0 || topScore <= 0) return { level: 'none', topScore: 0 };
  if (topScore >= 0.55) return { level: 'strong', topScore };
  if (topScore >= 0.35) return { level: 'partial', topScore };
  return { level: 'weak', topScore };
}

// Suggested follow-ups are picked from the curated question bank by shared
// vocabulary with the cited passages, so every chip is grounded in a real
// retrieved section and never duplicates the question that was just asked.
function buildFollowUps({ question, sources = [] }) {
  const asked = new Set(tokenize(question));
  const sourceTokens = new Set();
  for (const source of sources) {
    for (const token of tokenize(`${source.section || ''} ${source.excerpt || ''}`)) {
      sourceTokens.add(token);
    }
  }

  const scored = [];
  for (const item of SUGGESTED_QUESTIONS) {
    const questionTokens = tokenize(item.question);
    if (questionTokens.length === 0) continue;
    const overlap =
      questionTokens.filter((token) => sourceTokens.has(token)).length / questionTokens.length;
    if (overlap <= 0) continue;
    const sameAsAsked =
      questionTokens.filter((token) => asked.has(token)).length / questionTokens.length;
    if (sameAsAsked > 0.6) continue;
    scored.push({ label: item.label, question: item.question, icon: item.icon, overlap });
  }

  scored.sort((a, b) => b.overlap - a.overlap);
  const picks = scored.slice(0, 3).map(({ label, question: value, icon }) => ({
    label,
    question: value,
    icon,
  }));

  // The curated bank is small, so top up with grounded section prompts taken
  // from the cited passages themselves.
  if (picks.length < 3) {
    const seen = new Set();
    for (const source of sources) {
      if (picks.length >= 3) break;
      const name = String(source.section || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const value = `What else does the handbook say about "${name}"?`;
      if (tokenize(value).every((token) => asked.has(token))) continue;
      picks.push({
        label: name.length > 30 ? `More on ${name.slice(0, 30)}…` : `More on ${name}`,
        question: value,
        icon: 'book',
      });
    }
  }

  return picks;
}

function buildRetrievalQuery(message, history, imageAnalysis, analysis = null) {
  const question = String(message || '').trim();
  const contextual = analysis || analyseConversation(question, history);
  let query = contextual.contextQuery || question;
  if (imageAnalysis) {
    query += ` ${String(imageAnalysis).replace(/\s+/g, ' ').slice(0, 900)}`;
  }
  return query.slice(0, 1800);
}

function isImageReference(message) {
  return IMAGE_REFERENCE.test(String(message || ''));
}

function isImageOnlyQuestion(message, analysis, hasAttachment) {
  if (!hasAttachment) return false;
  if (analysis.category === 'image_question') return true;
  if (analysis.schoolTerms?.length > 0) return false;
  return isImageReference(message);
}

async function relatedSourcesFor(analysis) {
  if (!analysis.relatedSources || !RELATED_QUERIES[analysis.relatedSources]) return [];
  try {
    const retrieval = await searchHandbook(RELATED_QUERIES[analysis.relatedSources], {
      topK: 6,
    });
    const pattern = RELATED_SECTION_PATTERNS[analysis.relatedSources];
    const filtered = retrieval.results.filter((result) => pattern.test(result.section));
    return mergeSources((filtered.length > 0 ? filtered : retrieval.results).slice(0, 2));
  } catch {
    return [];
  }
}

function demoAnswer({ sources, hasImage, imageOnly, hasWeakResults, variant = 'demo' }) {
  const excerptsOnly = variant === 'excerpts';
  const lines = [
    excerptsOnly ? '**Handbook excerpts — not AI-written**' : '**Local demo — not AI**',
    '',
  ];
  const noAnalysis = excerptsOnly
    ? 'Image analysis is skipped while handbook-only mode is on, so the attached image was received but **not analyzed**.'
    : 'No AI provider is configured, so the attached image was received but **not analyzed**.';
  const enableImage = excerptsOnly
    ? 'Turn off handbook-only mode to enable image understanding.'
    : 'To enable image understanding, add an AI provider key to `.env` and restart the server.';

  if (hasImage && imageOnly) {
    lines.push(
      `${noAnalysis} I cannot read, summarize, or answer questions about the image itself.`,
      '',
      `You can type the text from the image and ask about the handbook policy it mentions. ${enableImage}`
    );
    return lines.join('\n');
  }

  if (hasImage) {
    lines.push(`${noAnalysis} I cannot use the image as context for this answer.`, '');
  }

  if (!sources.length) {
    lines.push(
      "I couldn't find a clear answer to this in the available student handbook. Please confirm with the appropriate school office before relying on it.",
      '',
      excerptsOnly
        ? 'These are direct handbook excerpts, not an AI-written answer.'
        : 'This is a local retrieval demo, not an AI-generated answer.'
    );
    return lines.join('\n');
  }

  lines.push(
    hasWeakResults
      ? 'I found only limited handbook coverage for this question. These are the closest passages I found:'
      : 'Here are the most relevant handbook passages I found:',
    ''
  );

  sources.forEach((source, index) => {
    lines.push(
      `**${index + 1}. ${source.section} — ${formatPageRange(source)}**`,
      '',
      source.excerpt
        .split(/\n{2,}/)
        .map((paragraph) => `> ${paragraph.trim()}`)
        .join('\n>\n'),
      ''
    );
  });

  lines.push(
    excerptsOnly
      ? 'These are direct handbook excerpts, not an AI-written answer. Turn off handbook-only mode in the composer for a written answer.'
      : 'This is a local retrieval demo, not an AI-generated answer. To enable AI-written answers, add an AI provider key to `.env` and restart the server.'
  );
  return lines.join('\n');
}

function studentFacingImageError(error) {
  const code = error?.code;
  if (code === 'timeout') {
    return 'The image analysis service took too long to respond. Please try again.';
  }
  if (code === 'rate_limited') {
    return 'The image analysis service is busy right now. Please wait a moment and try again.';
  }
  if (code === 'image_too_large' || code === 'image_dimensions_too_large') {
    return 'The image is too large for analysis. Try a smaller or compressed image.';
  }
  if (code === 'invalid_image' || code === 'unsupported_image' || code === 'unsupported_image_type') {
    return 'The image could not be read. Try a clear JPEG, PNG, or WebP image.';
  }
  if (code === 'model_not_found' || code === 'model_retired') {
    // Seen live: the provider lists a vision model in its catalogue but has not
    // deployed it for the account, which surfaces as a 404 for a valid ID.
    return 'The configured vision model is not available to this provider account. Enable it in the provider dashboard or set AI_VISION_MODEL to a supported vision model, then try again. You can also type the relevant text instead.';
  }
  if (code === 'auth_error' || code === 'not_configured') {
    return 'The image analysis service is not configured correctly. Please tell the site administrator, or type the relevant text instead.';
  }
  if (code === 'provider_unavailable' || code === 'network_error') {
    return 'The image analysis service is temporarily unavailable. Please try again shortly or type the relevant text.';
  }
  return 'I could not analyze the attached image. Try a clearer image, or type the relevant text and ask again.';
}

function appendSafetyNote(answer, analysis) {
  if (analysis.weaponRelated) {
    if (/school security|trusted school official|emergency services|911/i.test(answer)) return answer;
    return `${answer}\n\nIf you have a real safety concern, contact school security or a trusted school official. If there is an immediate threat, call local emergency services (911 in the Philippines).`;
  }
  if (analysis.category === 'violence_policy') {
    if (/guidance counselor|trusted school official|school security|homeroom adviser|principal/i.test(answer)) {
      return answer;
    }
    return `${answer}\n\nIf you feel unsafe or need help handling a conflict, talk to your guidance counselor, homeroom adviser, or a trusted school official.`;
  }
  return answer;
}

function extractCitations(answer) {
  const pages = [];
  const pattern = /\b(?:pp?\.?|pages?)\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/gi;
  let match;
  while ((match = pattern.exec(answer)) !== null) {
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    if (Number.isFinite(start)) pages.push({ start, end: Number.isFinite(end) ? end : start });
  }
  return pages;
}

function verifyCitations(answer, sources) {
  if (!sources.length) return { ok: true, checked: 0, invalid: [], missing: false };
  const allowed = new Set();
  for (const source of sources) {
    const start = Number(source.page);
    const end = Number(source.pageEnd ?? source.page);
    if (!Number.isFinite(start)) continue;
    const last = Number.isFinite(end) ? Math.min(end, start + 30) : start;
    for (let page = start; page <= last; page += 1) allowed.add(page);
  }
  const citations = extractCitations(answer);
  if (citations.length === 0) {
    return { ok: false, checked: 0, invalid: [], missing: true };
  }
  const invalid = citations.filter(({ start, end }) => {
    const last = Math.min(Math.max(start, end), start + 30);
    for (let page = start; page <= last; page += 1) {
      if (!allowed.has(page)) return true;
    }
    return false;
  });
  return {
    ok: invalid.length === 0,
    checked: citations.length,
    invalid: invalid.map(({ start, end }) => (start === end ? String(start) : `${start}-${end}`)),
    missing: false,
  };
}

function ensureHandbookFallback(answer, sources, analysis) {
  if (sources.length > 0 || analysis.category === 'image_question') return answer;
  if (
    /couldn'?t find|could not find|not (?:clearly )?(?:covered|specified|stated|mentioned)|no (?:clear )?(?:answer|information)|confirm with/i.test(
      answer
    )
  ) {
    return answer;
  }
  return `${answer}\n\n> I couldn't find a handbook passage that clearly answers this. Please confirm with the appropriate school office before relying on it.`;
}

function responseMeta({ retrieval, imageMeta, timings, confidence = null }) {
  return {
    provider: config.ai.provider,
    chatModel: config.features.demoMode ? null : config.ai.model,
    visionModel: config.features.demoMode ? null : config.ai.visionModel,
    demoMode: config.features.demoMode,
    embeddingProvider: config.embeddings.provider,
    retrievedChunks: retrieval?.results?.length || 0,
    topScore: retrieval?.topScore || 0,
    // How well the retrieved passages matched the question: strong / partial /
    // weak / none. The UI shows this so students know when to double-check.
    confidence: confidence || confidenceFor(retrieval),
    generatedAt: new Date().toISOString(),
    timings,
    image: imageMeta
      ? {
          width: imageMeta.width,
          height: imageMeta.height,
          mimeType: imageMeta.mimeType,
          analyzed: imageMeta.analyzed,
        }
      : null,
  };
}

function guideResponse({
  question = '',
  analysis,
  sources = [],
  imageMeta = null,
  warnings = [],
  timings = {},
}) {
  return {
    id: randomUUID(),
    mode: 'guide',
    aiGenerated: false,
    answer: analysis.response || GUIDE_RESPONSES.outOfScope,
    sources,
    followUps: buildFollowUps({ question, sources }),
    safety: {
      level: analysis.safetyLevel,
      category: analysis.category,
      claimToVerify: Boolean(analysis.claimToVerify),
    },
    image: imageMeta
      ? {
          id: imageMeta.id,
          name: imageMeta.name,
          mimeType: imageMeta.mimeType,
          width: imageMeta.width,
          height: imageMeta.height,
          analyzed: imageMeta.analyzed,
          warning: imageMeta.warning || null,
        }
      : null,
    warnings,
    meta: responseMeta({ retrieval: null, imageMeta, timings }),
  };
}

/**
 * Handle one chat turn.
 *
 * @param {object} input
 * @param {string} input.message
 * @param {Array<{role: string, content: string}>} [input.history]
 * @param {string|null} [input.attachmentId]
 * @param {string} [input.ownerKey]
 * @param {AbortSignal|null} [input.signal] - cancels the provider call when the client disconnects.
 * @param {Function|null} [input.onStreamStart] - called with sources/safety before the first token.
 * @param {Function|null} [input.onDelta] - called with each visible text chunk; enables streaming.
 */
export async function handleChat({
  message,
  history = [],
  attachmentId = null,
  ownerKey = '',
  preferExcerpts = false,
  signal = null,
  onStreamStart = null,
  onDelta = null,
} = {}) {
  const startedAt = Date.now();
  const question = String(message || '').trim();
  const hasAttachment = Boolean(attachmentId);
  // A newly attached image supplies the referent for "this", rather than an
  // earlier handbook topic or capability introduction.
  let analysis = analyseConversation(question, hasAttachment && isImageReference(question) ? [] : history);

  // A question about an uploaded image often has no handbook keywords
  // ("What does this say?"). Give those a chance to reach the vision step,
  // but never override safety, personal-data, or general-task decisions.
  if (
    hasAttachment &&
    analysis.action === 'guide' &&
    ['out_of_scope', 'clarification'].includes(analysis.category) &&
    isImageReference(question)
  ) {
    analysis = {
      ...analysis,
      action: 'allow',
      category: 'image_question',
      response: null,
      safetyLevel: 'none',
      reason: 'question about an uploaded image',
    };
  }

  if (analysis.action === 'guide') {
    const sources = await relatedSourcesFor(analysis);
    return guideResponse({
      question,
      analysis,
      sources,
      imageMeta: hasAttachment
        ? {
            id: attachmentId,
            name: null,
            mimeType: null,
            width: null,
            height: null,
            analyzed: false,
            warning: null,
          }
        : null,
      timings: { totalMs: Date.now() - startedAt },
    });
  }

  const attachment = hasAttachment ? getAttachment(attachmentId, ownerKey) : null;
  const imageOnly = isImageOnlyQuestion(question, analysis, Boolean(attachment));

  let imageMeta = attachment
    ? {
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        width: attachment.width,
        height: attachment.height,
        analyzed: false,
        warning: null,
      }
    : null;
  let imageAnalysisText = '';
  let visionUsage = null;
  let imageWarning = null;
  const timings = {};

  if (attachment && !config.features.demoMode) {
    const visionStarted = Date.now();
    try {
      const vision = await analyseImage({
        question,
        attachment,
        timeoutMs: config.ai.visionTimeoutMs,
      });
      imageAnalysisText = vision.analysis;
      visionUsage = vision.usage;
      imageMeta.analyzed = true;
      imageMeta.model = vision.model;
    } catch (error) {
      const warning = studentFacingImageError(error);
      imageMeta.analyzed = false;
      imageMeta.warning = warning;
      imageWarning = warning;
      // If the student asked only about the image, a text-only answer would be
      // misleading. Explain the failure instead of pretending to see it.
      if (imageOnly) {
        return guideResponse({
          question,
          analysis: {
            ...analysis,
            response: `${warning}\n\nYou can try uploading a clearer image, or type the text from the image and ask your question again.`,
          },
          imageMeta,
          warnings: [warning],
          timings: { ...timings, visionMs: Date.now() - visionStarted, totalMs: Date.now() - startedAt },
        });
      }
    }
    timings.visionMs = Date.now() - visionStarted;
  }

  const retrievalStarted = Date.now();
  let retrieval;
  try {
    retrieval = await searchHandbook(
      buildRetrievalQuery(question, history, imageAnalysisText, analysis),
      { topK: 7 }
    );
  } catch (error) {
    throw new HttpError(
      503,
      'index_unavailable',
      error?.message ||
        'The handbook index is unavailable. Run `npm run index` and restart the server.',
      { cause: error }
    );
  }
  timings.retrievalMs = Date.now() - retrievalStarted;

  const modelSources = selectSources(retrieval.results);
  const displaySources = mergeSources(modelSources);
  const weakResults = retrieval.topScore > 0 && retrieval.topScore < 0.35;
  const imageQuestion = imageOnly;
  const warnings = [];
  if (retrieval.warnings?.length) warnings.push(...retrieval.warnings);
  if (imageWarning) warnings.push(imageWarning);

  if (config.features.demoMode || preferExcerpts) {
    // "excerpts" is the same retrieval answer as demo mode, but it is an
    // explicit student choice on an AI-configured server ("handbook only"),
    // so it carries its own honest label.
    const variant = config.features.demoMode ? 'demo' : 'excerpts';
    const answer = demoAnswer({
      sources: displaySources,
      hasImage: Boolean(attachment),
      imageOnly: imageQuestion,
      hasWeakResults: weakResults,
      variant,
    });
    const sources = imageQuestion ? [] : displaySources;
    if (isUnansweredAnswer(answer)) {
      // Anonymous coverage-gap record: which question the handbook failed to
      // answer. Never stores client identifiers (see src/services/gapLog.js).
      await recordUnansweredQuestion({
        question,
        mode: variant,
        retrieval,
        sources: displaySources,
      });
    }
    const followUps = buildFollowUps({ question, sources });
    const safety = {
      level: analysis.safetyLevel,
      category: analysis.category,
      claimToVerify: Boolean(analysis.claimToVerify),
    };
    // Without a vision model the image was not analyzed, so retrieved text
    // from a generic "what does this say?" question would be misleading.
    const imagePayload = imageMeta
      ? {
          id: imageMeta.id,
          name: imageMeta.name,
          mimeType: imageMeta.mimeType,
          width: imageMeta.width,
          height: imageMeta.height,
          analyzed: false,
          warning:
            variant === 'excerpts'
              ? 'Image analysis is skipped in handbook-only mode.'
              : 'Image analysis requires a configured AI provider.',
        }
      : null;

    if (typeof onStreamStart === 'function') {
      onStreamStart({
        mode: variant,
        sources,
        safety,
        image: imagePayload,
        warnings,
        followUps,
        confidence: confidenceFor(retrieval).level,
      });
    }

    return {
      id: randomUUID(),
      mode: variant,
      aiGenerated: false,
      answer,
      sources,
      followUps,
      safety,
      image: imagePayload,
      warnings,
      meta: responseMeta({
        retrieval,
        imageMeta,
        timings: { ...timings, totalMs: Date.now() - startedAt },
      }),
    };
  }

  let documentMeta = null;
  try {
    documentMeta = await getIndexMeta();
  } catch {
    documentMeta = null;
  }

  const retrievalNote = modelSources.length === 0
    ? 'No retrieved passage passed the relevance threshold. Do not answer the policy question from memory.'
    : weakResults
      ? 'The retrieved passages are only a weak match. If they do not directly answer the question, say that you could not find a clear answer.'
      : '';

  const messages = buildMessages({
    question,
    sources: modelSources,
    history,
    imageAnalysis: imageAnalysisText,
    safety: analysis,
    hasImage: Boolean(attachment),
    documentMeta,
    retrievalNote,
    historyLimits: {
      maxMessages: config.limits.maxHistoryMessages,
      maxChars: config.limits.maxHistoryChars,
    },
  });

  const streamSafety = {
    level: analysis.safetyLevel,
    category: analysis.category,
    claimToVerify: Boolean(analysis.claimToVerify),
  };
  const followUps = buildFollowUps({ question, sources: displaySources });
  const confidence = confidenceFor(retrieval);

  if (typeof onStreamStart === 'function') {
    onStreamStart({
      mode: 'ai',
      sources: displaySources,
      safety: streamSafety,
      image: imageMeta
        ? {
            id: imageMeta.id,
            name: imageMeta.name,
            mimeType: imageMeta.mimeType,
            width: imageMeta.width,
            height: imageMeta.height,
            analyzed: imageMeta.analyzed,
            warning: imageWarning,
          }
        : null,
      warnings,
      followUps,
      confidence: confidence.level,
      meta: responseMeta({ retrieval, imageMeta, timings: { ...timings } }),
    });
  }

  const streaming = typeof onDelta === 'function';
  const chatStarted = Date.now();
  let completion;
  try {
    completion = streaming
      ? await streamChatCompletion({
          messages,
          model: config.ai.model,
          timeoutMs: config.ai.timeoutMs,
          maxTokens: config.ai.maxOutputTokens,
          temperature: config.ai.temperature,
          onDelta,
          signal,
        })
      : await chatCompletion({
          messages,
          model: config.ai.model,
          timeoutMs: config.ai.timeoutMs,
          maxTokens: config.ai.maxOutputTokens,
          temperature: config.ai.temperature,
        });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      'provider_error',
      'The AI provider request failed unexpectedly. Please try again.',
      { status: 502, cause: error }
    );
  }
  timings.chatMs = Date.now() - chatStarted;

  let answer = String(completion.content || '').replace(/\u0000/g, '').trim();
  if (answer.length > 12000) {
    answer = `${answer.slice(0, 12000).trim()}\n\n[Response shortened.]`;
  }
  // A half-finished policy answer is worse than no answer, because a student may
  // act on the part that arrived. Say so rather than passing it off as complete.
  if (completion.finishReason === 'length') {
    warnings.push(
      'The AI answer stopped at the output length limit, so it may be incomplete. Ask a narrower question, or raise AI_MAX_OUTPUT_TOKENS.'
    );
    answer +=
      '\n\n> This answer was cut off at the length limit and may be incomplete. Please read the source cards below, or ask a narrower question.';
  }
  if (imageWarning) {
    answer += `\n\n> Image note: ${imageWarning}`;
  }
  answer = ensureHandbookFallback(answer, modelSources, analysis);
  if (isUnansweredAnswer(answer)) {
    // Anonymous coverage-gap record: which question the handbook failed to
    // answer. Never stores client identifiers (see src/services/gapLog.js).
    await recordUnansweredQuestion({
      question,
      mode: 'ai',
      retrieval,
      sources: displaySources,
    });
  }
  answer = appendSafetyNote(answer, analysis);

  const citationCheck = verifyCitations(answer, modelSources);
  if (citationCheck.missing) {
    warnings.push(
      'The answer did not include an inline page citation. Use the source cards below to verify the retrieved passages.'
    );
  } else if (!citationCheck.ok) {
    warnings.push(
      `The answer cited page(s) ${citationCheck.invalid.join(
        ', '
      )} that were not among the retrieved passages. Use the source cards below to verify.`
    );
    answer += `\n\n> Citation check: one or more page references could not be verified against the retrieved passages. Please use the source cards below.`;
  }

  return {
    id: randomUUID(),
    mode: 'ai',
    aiGenerated: true,
    answer,
    sources: displaySources,
    followUps,
    safety: {
      level: analysis.safetyLevel,
      category: analysis.category,
      claimToVerify: Boolean(analysis.claimToVerify),
    },
    image: imageMeta
      ? {
          id: imageMeta.id,
          name: imageMeta.name,
          mimeType: imageMeta.mimeType,
          width: imageMeta.width,
          height: imageMeta.height,
          analyzed: imageMeta.analyzed,
          warning: imageWarning,
        }
      : null,
    warnings,
    usage: {
      chat: completion.usage,
      vision: visionUsage,
    },
    model: completion.model,
    meta: responseMeta({
      retrieval,
      imageMeta,
      timings: { ...timings, totalMs: Date.now() - startedAt },
      confidence,
    }),
  };
}

export const __testing = {
  buildRetrievalQuery,
  mergeSources,
  selectSources,
  verifyCitations,
  extractCitations,
  demoAnswer,
  studentFacingImageError,
  buildFollowUps,
  confidenceFor,
};
