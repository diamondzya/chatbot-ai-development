import { analyseMessage, GUIDE_RESPONSES } from './safetyFilter.js';

function normalise(message) {
  return String(message || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function isFollowUp(message) {
  const text = normalise(message).replace(/(?:[.!?]+|\s+(?:po|please))+$/g, '');
  return (
    /^(?:what else|anything else|anything more|tell me more|more|go on|continue|why|why not|how so|like what|such as|examples?|give me (?:an example|examples)|(?:can you )?explain(?: (?:more|further|that|it|this))?|ano pa|iba pa|meron pa|mayroon pa|bakit|paano|pano)$/.test(text) ||
    // Consequences and next steps often omit both the topic and a pronoun.
    // Keep these anchored so a complete new question ("what happens if I lose
    // my ID?") does not inherit an unrelated earlier incident.
    /^(?:so[, ]+)?(?:what (?:happens|(?:will|would|could|might) happen)(?: (?:next|then|to me|to us))?|what (?:are|is|would be|will be) (?:the )?(?:consequences|penalties|punishment|sanctions|next steps?)|will i get in trouble|what should i do(?: (?:next|now))?)$/.test(text) ||
    /^(?:ano (?:ang )?(?:mangyayari|mangyayare)(?: (?:sa akin|sakin|sa amin|pagkatapos))?|(?:ano|anong) (?:ang )?(?:parusa|consequences)|ano (?:ang )?(?:dapat kong gawin|gagawin ko)(?: ngayon)?)$/.test(text) ||
    /^(?:what about|how about|and|then|what if|paano naman|ano naman|yun|yon|that|it)\b/.test(text) ||
    /\b(?:it|that|this|those|them|iyon|yan|iyan|yun|yon)\b/.test(text)
  );
}

function classifyTurn(message, previous) {
  const analysis = analyseMessage(message);
  // A follow-up never overrides an explicit safety, privacy, or unrelated-task
  // decision made on the current message.
  if ((analysis.action === 'guide' && analysis.category !== 'out_of_scope') || !isFollowUp(message)) {
    return analysis;
  }

  if (previous?.analysis.action === 'allow') {
    const topic = previous.analysis.contextQuery || previous.message;
    // Recheck the combined intent: "how can I hide it?" after a weapon or
    // gadget question must retain the same protections as an explicit request.
    const combined = analyseMessage(`${message} ${topic}`);
    return {
      ...combined,
      contextQuery: `${topic.slice(0, 1200)} ${message}`.slice(0, 1800),
    };
  }

  // A new named school subject can start a topic after an introduction/refusal.
  if (analysis.action === 'allow') return analysis;

  if (['meta', 'greeting'].includes(previous?.analysis.category)) {
    return {
      ...analysis,
      category: 'meta',
      response: previous.analysis.response === GUIDE_RESPONSES.moreCapabilities
        ? GUIDE_RESPONSES.chooseTopic
        : GUIDE_RESPONSES.moreCapabilities,
      reason: 'follow-up about assistant capabilities',
    };
  }

  // Do not resurrect an older school topic after a refused or unrelated turn.
  if (previous && !['out_of_scope', 'clarification'].includes(previous.analysis.category)) {
    return previous.analysis;
  }

  return {
    ...analysis,
    category: 'clarification',
    response: GUIDE_RESPONSES.clarifyFollowUp,
    reason: 'follow-up without a school topic in recent history',
  };
}

/** Resolve conversational intent from recent user turns, never assistant claims. */
export function analyseConversation(message, history = []) {
  let previous = null;
  const turns = Array.isArray(history) ? history.slice(-12) : [];
  for (const turn of turns) {
    if (turn?.role !== 'user' || typeof turn.content !== 'string' || !turn.content.trim()) continue;
    const content = turn.content.trim().slice(0, 4000);
    const analysis = classifyTurn(content, previous);
    // A polite acknowledgement does not erase the topic being discussed.
    if (analysis.category === 'thanks') continue;
    previous = { message: content, analysis };
  }
  return classifyTurn(String(message || '').trim(), previous);
}
