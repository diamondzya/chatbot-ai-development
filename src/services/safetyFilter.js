/**
 * Deterministic scope and safety layer.
 *
 * This runs before any AI request. It never tries to answer a school-policy
 * question itself; it only decides whether a question is in scope and whether
 * a deterministic safety/scope response should replace an AI call.
 *
 * The goal is to be protective without labelling students. A student asking
 * "Can I bring a knife to school?" is asking a policy question and should get
 * the handbook answer plus a calm safety note. A student asking how to hide a
 * weapon is asking for help that we must not provide.
 */

const SCHOOL_TERMS = [
  // Core school / handbook
  'sti',
  'school',
  'campus',
  'student',
  'students',
  'handbook',
  'manual',
  'policy',
  'policies',
  'rule',
  'rules',
  'regulation',
  'regulations',
  'guideline',
  'guidelines',
  'official',
  'announcement',
  'announcements',
  'bulletin',
  'orientation',
  'academic',
  'curriculum',
  'program',
  'programs',
  'junior high',
  'senior high',
  'grade 7',
  'grade 11',
  'grade 12',
  'jhs',
  'shs',

  // People and offices
  'teacher',
  'teachers',
  'professor',
  'principal',
  'assistant principal',
  'adviser',
  'advisor',
  'homeroom',
  'guidance',
  'counselor',
  'counsellor',
  'counseling',
  'counselling',
  'registrar',
  'cashier',
  'librarian',
  'nurse',
  'clinic',
  'security',
  'guard',
  'discipline committee',
  'administration office',
  'school official',
  'school personnel',
  'parent',
  'parents',
  'guardian',
  'guardians',
  'visitor',
  'visitors',

  // Attendance and behavior
  'attendance',
  'punctuality',
  'tardy',
  'tardiness',
  'late',
  'absent',
  'absence',
  'absences',
  'excuse letter',
  'medical certificate',
  'cut class',
  'cutting class',
  'skip class',
  'class',
  'classes',
  'classroom',
  'discipline',
  'disciplinary',
  'offense',
  'offenses',
  'violation',
  'violations',
  'sanction',
  'sanctions',
  'penalty',
  'penalties',
  'suspension',
  'suspended',
  'expulsion',
  'exclusion',
  'warning',
  'reprimand',
  'due process',
  'hearing',
  'complaint',
  'complaints',
  'cheating',
  'cheat',
  'plagiarism',
  'plagiarize',
  'plagiarise',
  'bullying',
  'bully',
  'bullied',
  'cyberbullying',
  'harassment',
  'hazing',
  'classmate',
  'classmates',
  'schoolmate',
  'schoolmates',
  'fight',
  'fighting',
  'threat',
  'threats',
  'vandalism',
  'stealing',
  'theft',
  'extortion',
  'blackmail',
  'bribery',
  // Inflections and spellings students actually type. Without these the scope
  // check found no school term and answered a real concern ("someone stole my
  // bag", "will I get expelled") with a generic "what would you like to know?"
  // redirect. Erring towards allowing is the safer direction here: an allowed
  // off-topic question gets a grounded "not in the handbook" answer, while a
  // refused real question leaves a student with nothing.
  'stole',
  'steal',
  'stolen',
  'thief',
  'thieves',
  'robbed',
  'robbery',
  'broke',
  'broken',
  'damage',
  'damaged',
  'damaging',
  'destroyed',
  'destroying',
  'destruction',
  'vandalized',
  'vandalised',
  'vandalize',
  'vandalise',
  'expelled',
  'expel',
  'expulsion',
  'punched',
  'punch',
  'slapped',
  'kicked',
  'threatened',
  'rumour',
  'rumours',
  'rumor',
  'rumors',
  'gossip',
  'gossiping',
  'blackmailing',
  'skipped',
  'harassed',
  'harassing',
  'wallet',

  // Attire and ID
  'uniform',
  'uniforms',
  'attire',
  'dress code',
  'grooming',
  'haircut',
  'shoes',
  'slippers',
  'socks',
  'neckties',
  'necktie',
  'pe uniform',
  'laboratory uniform',
  'kitchen uniform',
  'id',
  'school id',
  'identification card',
  'temporary id',
  'lanyard',
  'strap',
  'affidavit of loss',
  'id replacement',
  'replacement',
  'unifrom',
  'uniforrm',
  'unifroms',
  'requirment',
  'requirments',
  'tardines',
  'attandance',
  'discpline',
  'weopon',
  'weopons',
  'bulling',
  'enrollement',
  'suspention',
  'labaratory',
  'scholaship',
  'harasment',

  // Gadgets, academics, activities
  'phone',
  'phones',
  'cellphone',
  'cellphones',
  'mobile phone',
  'gadget',
  'gadgets',
  'laptop',
  'laptops',
  'tablet',
  'device',
  'devices',
  'exam',
  'exams',
  'examination',
  'examinations',
  'quiz',
  'quizzes',
  'test',
  'tests',
  'grade',
  'grades',
  'grading',
  'general average',
  'subject',
  'subjects',
  'homework',
  'assignment',
  'assignments',
  'project',
  'projects',
  'performance task',
  'written works',
  'seatwork',
  'report card',
  'promotion',
  'retention',
  'probation',
  'honors',
  'awards',
  'graduation',
  'moving up',
  'club',
  'clubs',
  'organization',
  'organizations',
  'org',
  'orgs',
  'extracurricular',
  'competition',
  'field trip',
  'permission',
  'parent consent',
  'elms',
  'lms',
  'online class',
  'online classes',
  'genai',
  'generative ai',
  'artificial intelligence',
  'chatgpt',
  'ai',
  'citation',
  'citations',

  // Services and facilities
  'canteen',
  'cafeteria',
  'library',
  'learning resource center',
  'laboratory',
  'laboratories',
  'lab',
  'facility',
  'facilities',
  'comfort room',
  'restroom',
  'locker',
  'lockers',
  'lost and found',
  'lost',
  'found',
  'gate pass',
  'gate',
  'dismissal',
  'assembly',
  'flag ceremony',
  'flag raising',
  'flag lowering',
  'cctv',
  'bag check',
  'bag inspection',
  'frisking',
  'lockdown',
  'fire drill',
  'earthquake drill',
  'safety',
  'emergency',
  'health',
  'medical',
  'sick',
  'sickness',
  'injury',
  'counseling',
  'mental health',
  'stress',

  // Money and records
  'tuition',
  'school fees',
  'fees',
  'fee',
  'payment',
  'payments',
  'refund',
  'enrollment',
  'enrolment',
  'enroll',
  'admission',
  'admissions',
  'scholarship',
  'financial obligation',

  // Weather / class suspension
  'class suspension',
  'suspension of classes',
  'suspended classes',
  'walang pasok',

  // Weapons, drugs, and other safety-sensitive topics
  'weapon',
  'weapons',
  'deadly weapon',
  'dangerous weapon',
  'firearm',
  'firearms',
  'gun',
  'guns',
  'knife',
  'knives',
  'explosive',
  'explosives',
  'bomb',
  'drug',
  'drugs',
  'prohibited drugs',
  'illegal drugs',
  'smoking',
  'vape',
  'vaping',
  'cigarette',
  'cigarettes',
  'tobacco',
  'alcohol',
  'drunk',
  'intoxicated',

  // Filipino / Taglish content words
  'paaralan',
  'eskwela',
  'eskwelahan',
  'guro',
  'titser',
  'klase',
  'huli',
  'nahuli',
  'mahuhuli',
  'late',
  'absent',
  'liliban',
  'lumiban',
  'pasok',
  'pumasok',
  'makapasok',
  'makakapasok',
  'nakalimutan',
  'nalimutan',
  'nawala',
  'nawawala',
  'gamit',
  'uniporme',
  'damit',
  'suot',
  'isuot',
  'sapatos',
  'tsinelas',
  'selpon',
  'cellphone',
  'cp',
  'bawal',
  'ipinagbabawal',
  'bagyo',
  'lumabas',
  'aalis',
  'suspinde',
  'bagsak',
  'marka',
  'bayad',
  'magbayad',
  'tuition',
  'reklamo',
  'sandata',
  'baril',
  'patalim',
  'droga',
  'away',
  'binubully',
  'nambubully',
  'saktan',
  'emergency',
  'sakuna',
  'aksidente',
];

const POLICY_INTENT =
  /\b(?:handbook|manual|policy|policies|rule|rules|regulation|regulations|guideline|guidelines|allowed|permitted|prohibited|required|optional|penalty|penalties|sanction|sanctions|offense|offenses|violation|violations)\b/;

const GREETING = /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|kumusta|kamusta|magandang (?:umaga|hapon|gabi)|salamat|thank you|thanks|ok|okay|sige|bye|goodbye|paalam)(?:\s+po)?[!. ]*$/;

const SELF_HARM_CONCERN = [
  /\b(?:friend|classmate|schoolmate|someone|he|she|they|them)\b.*\b(?:wants?|is|are|plans?|trying|thinking about)\b.*\b(?:to\s+)?(?:die|kill (?:him|her|them)self|end (?:his|her|their) life|take (?:his|her|their) own life|hurt (?:him|her|them)self|cut (?:him|her|them)self|suicid(?:e|al)|self[- ]harm)\b/,
  /\b(?:kill|hurt|harm|cut)\s+(?:himself|herself|themself|themselves)\b/,
  /\b(?:my|a) friend\b.*\b(?:suicid(?:e|al)|self[- ]harm|want(?:s)? to die)\b/,
];

const SELF_HARM = [
  /\b(?:kill|hurt|harm|cut|injure|burn)\s+(?:myself|my self)\b/,
  /\b(?:want|wanna|plan|planning|going|gonna|trying)\s+to\s+(?:die|end my life|take my own life|kill myself)\b/,
  /\b(?:suicid(?:e|al)|self[- ]harm|self[- ]hurt)\b/,
  /\b(?:magpakamatay|nagpakamatay|pumatay ng sarili|saktan ang sarili|patayin ang sarili)\b/,
  /\b(?:better off dead|don't want to live|do not want to live|no reason to live)\b/,
];

const THREAT = [
  /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:going to|gonna|will|plan to|planning to)\s+(?:shoot|stab)\b/,
  /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:going to|gonna|will|plan to|planning to)\s+bomb\s+(?:the )?(?:school|campus|building|classroom)\b/,
  /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:going to|gonna|will|plan to|planning to)\s+(?:kill|hurt|harm|beat up|attack)\s+(?:you|him|her|them|someone|a student|another student|my classmate|my teacher|everyone|people|the school|campus)\b/,
  /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:going to|gonna|will|plan to|planning to)\s+bring\s+(?:a |my )?(?:gun|knife|weapon|firearm|bomb)\b/,
  /\b(?:i (?:want|plan|intend|feel like|am thinking about) (?:to )?(?:hurt|harm|kill|attack|stab|shoot|threaten|beat up)|i want to fight)\s+(?:you|him|her|them|someone|a student|another student|my classmate|my teacher|everyone|people)\b/,
  /\b(?:there(?:'s| is| are)|someone (?:has|brought|is bringing|will bring))\s+(?:a |an )?(?:gun|knife|weapon|bomb)\b/,
  /\b(?:i|we)\s+(?:have|brought|am carrying|have brought)\s+(?:a |an )?(?:gun|bomb)\b/,
  /\b(?:bomb threat|active shooter|school shooting|shooting at (?:the )?school)\b/,
  /\b(?:papatayin ko|sasaktan ko|may baril|may bomba|may sandata)\b/,
];

const VIOLENCE_INSTRUCTION = [
  /\b(?:how (?:can|do|would|should) i|how to|paano|pano)\b.*\b(?:hurt|harm|injure|attack|stab|shoot|kill|beat up|threaten|intimidate|scare|bully|get revenge)\b/,
  /\b(?:hurt|harm|injure|attack|stab|shoot|kill|beat up|threaten|intimidate|bully)\b.*\b(?:without getting caught|not get caught|without anyone (?:knowing|noticing)|and get away with)\b/,
  /\b(?:get revenge|revenge on)\b.*\b(?:classmate|student|teacher|someone)\b/,
];

const WEAPON_CONCEALMENT = [
  /\b(?:hide|conceal|sneak|smuggle|stash)\b.*\b(?:weapons?|guns?|knif(?:e|es)|firearms?|explosives?|sandata|baril|patalim)\b/,
  /\b(?:weapons?|guns?|knif(?:e|es)|firearms?|explosives?)\b.*\b(?:hide|conceal|sneak|smuggle|stash)\b/,
  /\b(?:bypass|get past|evade|avoid|fool|trick)\b.*\b(?:security|guard|bag check|bag inspection|frisking|metal detector)\b/,
  /\b(?:security|guard|bag check|bag inspection|metal detector)\b.*\b(?:bypass|get past|evade|avoid|fool|trick)\b/,
  /\b(?:how (?:can|do|would|should) i|how to|paano|pano)\b.*\b(?:bring|carry|sneak|smuggle|hide)\b.*\b(?:weapons?|guns?|knif(?:e|es)|firearms?|explosives?)\b.*\b(?:school|campus|class|guard|security)\b/,
  /\b(?:how|where|help|best way|paano|pano)\b.*\b(?:put|place|keep|carry|bring)\b.*\b(?:weapons?|guns?|knif(?:e|es)|firearms?|explosives?)\b.*\b(?:bag|backpack|bagahe)\b/,
];

const WEAPON_POLICY = [
  /\b(?:can|could|may|is it (?:okay|allowed|permitted)|are we allowed|pwede|puwede)\b.*\b(?:bring|carry|have|keep|possess|dala|magdala)\b.*\b(?:guns?|knif(?:e|es)|weapons?|firearms?|explosives?|sandata|baril|patalim)\b/,
  /\b(?:guns?|knif(?:e|es)|weapons?|firearms?|explosives?|sandata|baril|patalim)\b.*\b(?:allowed|permitted|prohibited|bawal|policy|rule|handbook|school|campus|penalty|sanction|offense)\b/,
  /\b(?:what happens|ano ang|ano mangyayari)\b.*\b(?:bring|carry|guns?|knif(?:e|es)|weapons?)\b/,
];

const WEAPON_TERM = /\b(?:weapons?|firearms?|guns?|knif(?:e|es)|explosives?|sandata|baril|patalim)\b/;
const VIOLENCE_TERM =
  /\b(?:(?:hurt|harm|injure|attack|stab|shoot|threaten|intimidate|fight|fighting|bull(?:y|ies|ied|ying)|harass(?:ed|es|ing)?|haz(?:e|ed|ing))|kill(?!\s+(?:it|time|the exam|the test|this exam|this test)))\b/;

const RULE_EVASION = [
  /\b(?:sneak|smuggle|hide|conceal)\b.*\b(?:phone|cellphone|gadget|vape|cigarette|alcohol|drugs?|prohibited item)\b.*\b(?:class|school|campus|guard|teacher|without)\b/,
  /\b(?:phone|cellphone|gadget|vape|cigarette|alcohol|drugs?)\b.*\b(?:sneak|smuggle|hide|conceal)\b.*\b(?:class|school|campus|guard|teacher)\b/,
  /\b(?:how (?:can|do|would|should) i|how to|paano|pano)\b.*\b(?:sneak|smuggle|hide|conceal)\b.*\b(?:phone|cellphone|gadget|vape|cigarette|alcohol|drugs?)\b/,
  /\b(?:how (?:can|do|would|should) i|how to|paano|pano)\b.*\b(?:get away with|avoid (?:getting )?caught|not get caught|without getting caught)\b.*\b(?:school|class|campus|rule|rules|teacher|guard)\b/,
];

const PROMPT_INJECTION = [
  /\b(?:ignore|disregard|forget|override)\b.*\b(?:previous|above|prior|earlier|your)\b.*\b(?:instructions?|prompts?|rules?|directions?|guidelines?)\b/,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/,
  /\b(?:reveal|show|print|repeat|output|leak)\b.*\b(?:system prompt|instructions|hidden prompt|your prompt)\b/,
  /\b(?:pretend|roleplay|role-play|imagine)\b.*\b(?:you are|you're|as if)\b/,
  // Fabrication framing: the verb has to introduce the handbook claim. A bare
  // "say" is ordinary English — "what does this notice say, and what does the
  // handbook say about IDs?" must not read as an override attempt — so it only
  // counts when used as an assertion about the handbook.
  /\b(?:pretend|imagine|claim)\b[^.!?]{0,40}\b(?:handbook|policy|policies|rules?)\b/,
  /\b(?:say|claim|state|insist)\s+that\b[^.!?]{0,60}\b(?:handbook|policy|policies|rules?)\b/,
  /\b(?:you are now|from now on you are|act as if you are)\b/,
  /\b(?:jailbreak|DAN mode|developer mode|do anything now)\b/,
  /\b(?:invent|make up|fabricate|create|write|generate)\b.*\b(?:school|sti)\b.*\b(?:policy|policies|rule|rules|regulation|penalty|sanction)\b/,
  /\b(?:invent|make up|fabricate)\b.*\b(?:policy|rule|regulation|penalty|sanction|handbook)\b/,
  /\b(?:don'?t|do not|without|no need to)\s+(?:use|cite|follow|read)\b.*\b(?:handbook|source|sources|citation|citations|rules)\b/,
  /\b(?:answer|respond)\b.*\b(?:as if|like)\b.*\b(?:handbook|policy|rules?)\b/,
];

const ACADEMIC_DISHONESTY = [
  /\b(?:how (?:can|do|would) i|how to|paano|pano)\b.*\b(?:cheat|copy (?:answers|from)|plagiari[sz]e|pass (?:the )?exam without studying|get answers)\b/,
  /\b(?:cheat|copy answers|plagiari[sz]e)\b.*\b(?:without getting caught|not get caught|and not get caught)\b/,
];

// A request to look up the student's own record. The app has no access to
// student data, so it must say so — but only when the student is actually
// asking for the value. A wellbeing or policy question that merely mentions
// grades ("my grades are low, is there help", "I feel stressed about my
// grades") has to reach the handbook instead of being brushed off.
const PERSONAL_DATA = [
  /\b(?:what(?:'s| is| are)|how (?:many|much)|show me|tell me|give me|can i (?:see|check|view)|i (?:want|need|would like) to (?:see|check|view|know)|check|look ?up)\b[^?.!]{0,40}\b(?:my|our)\s+(?:grade|grades|gwa|general average|attendance|record|records|balance|tuition balance|student number|lrn|account)\b/,
  /\b(?:password|otp|one[- ]time password|login credentials?)\b/,
  /\b(?:student id number|lrn)\b/,
];

const META = [
  /^(?:who|what) are you\??$/,
  /^(?:what can you do|how can you help|can you help(?: me)?)\??$/,
  /\b(?:are|is) (?:you|this|it)\b.*\b(?:official|affiliated|endorsed)\b/,
  /\b(?:are|is) (?:you|this|it)\b.*\b(?:ai|bot|real|human)\b/,
  /\bwhat (?:model|ai model|llm) (?:are you|do you use)\b/,
  /\b(?:do you use|are you connected to)\b.*\b(?:internet|api|ai|nvidia|openai)\b/,
  /^(?:what is|who is) sti assist ai\??$/,
  /^(?:who made|who created|who built) you\??$/,
];

const CREATIVE_OR_CODE_TASK =
  /\b(?:write|make|create|compose|generate|draw|code|build|tell)\b.*\b(?:poem|joke|story|song|rap|essay|script|program|code|app|website|game|recipe|movie|fanfic)\b/;

const HOMEWORK_TASK =
  /\b(?:do|solve|answer|complete|write|make|help me (?:with|do))\b.*\b(?:homework|assignment|programming assignment|math problem|problem set|quiz|exam)\b/;

const GENERAL_TRIVIA =
  /\b(?:capital of|president of|prime minister|population of|who won|what year did|meaning of life|horoscope|zodiac|netflix|anime|song lyrics|recipe|cook|bake|who would win|fictional battle|superhero|marvel|dc comics|tell me a joke)\b/;

const MATH_ONLY = /^[\s\d+\-*/=×÷^().,%]+$/;

const FUZZY_SCHOOL_TERMS = [
  ...new Set([
    'uniform',
    'requirement',
    'requirements',
    'tardiness',
    'attendance',
    'absence',
    'discipline',
    'disciplinary',
    'weapon',
    'weapons',
    'bullying',
    'harassment',
    'enrollment',
    'enrolment',
    'suspension',
    'expulsion',
    'laboratory',
    'graduation',
    'scholarship',
    'curriculum',
    'examination',
    'assignment',
    'identification',
    'confiscation',
    'confiscate',
    'tuition',
    'teacher',
    'student',
    'library',
    'handbook',
  ]),
].filter((term) => /^[a-z]+$/.test(term) && term.length >= 6);

const FUZZY_SCHOOL_SET = new Set(FUZZY_SCHOOL_TERMS);
const DIRECT_SCHOOL_WORD_SET = new Set(
  [...new Set(SCHOOL_TERMS)].filter((term) => /^[a-z]+$/.test(term))
);

const SCHOOL_TERM_MATCHERS = [...new Set(SCHOOL_TERMS)].map((term) => {
  if (/[\s-]/.test(term)) return { term, test: (text) => text.includes(term) };
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return { term, test: (text) => regex.test(text) };
});

function normalise(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function anyMatch(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function isOneEditApart(a, b) {
  if (a === b) return true;
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
    if (edits > 0) return false;
    // Treat a single adjacent transposition ("unifrom" -> "uniform") as one edit.
    if (i + 1 < a.length && j + 1 < b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      i += 2;
      j += 2;
      edits += 1;
      continue;
    }
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
    edits += 1;
  }
  if (i < a.length || j < b.length) {
    if (edits > 0) return false;
    edits += 1;
  }
  return edits <= 1;
}

function fuzzySchoolTermHits(text) {
  const tokens = text
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => /^[a-z]{6,}$/.test(token));
  const hits = new Set();
  for (const token of tokens) {
    if (DIRECT_SCHOOL_WORD_SET.has(token) || FUZZY_SCHOOL_SET.has(token)) continue;
    for (const term of FUZZY_SCHOOL_TERMS) {
      if (term[0] !== token[0]) continue;
      if (Math.abs(term.length - token.length) > 1) continue;
      if (isOneEditApart(token, term)) {
        hits.add(term);
        break;
      }
    }
  }
  return hits;
}

function schoolTermHits(text) {
  const hits = [];
  for (const matcher of SCHOOL_TERM_MATCHERS) {
    if (matcher.test(text)) hits.push(matcher.term);
  }
  for (const term of fuzzySchoolTermHits(text)) hits.push(term);
  return [...new Set(hits)];
}

function detectsClaimToVerify(text) {
  const mentionsSource = /\b(?:handbook|manual|student handbook|policy|policies|rules?)\b/.test(text);
  const assertion =
    /\b(?:says?|states?|allows?|permits?|requires?|prohibits?|bans?|is optional|is allowed|is not allowed|is required|is prohibited)\b/.test(
      text
    );
  const asksForConfirmation =
    /\b(?:i (?:heard|was told|read)|someone (?:told|said)|isn'?t it true|right\?|correct\?|di ba|diba)\b/.test(
      text
    );
  const modal = /\b(?:can|may|allowed|optional|required|prohibited|banned)\b/.test(text);
  return mentionsSource && assertion && (asksForConfirmation || modal);
}

export const GUIDE_RESPONSES = Object.freeze({
  outOfScope:
    "I'm STI Assist AI, a student handbook assistant. I can help you understand school rules, student policies, and common campus concerns. What would you like to know about school?",
  generalTask:
    "I can't write poems, do homework, solve general trivia, or take on unrelated tasks. I'm a student handbook assistant, so I can help with school rules, student policies, and common campus concerns. What would you like to know about school?",
  promptInjection:
    "I can't override my instructions, reveal internal prompts, or make up school policies. I can only answer from the available STI student handbook and will cite the section and page when possible. What school policy or campus concern can I help you with?",
  personalData:
    "I can't access or verify personal records such as grades, attendance, balances, student numbers, or account details. Please use the official student portal or contact your Homeroom Adviser or the Registrar. I can still explain handbook policies.",
  meta:
    "I'm STI Assist AI, an unofficial prototype that answers questions using the STI High School Student Handbook 2026 (published July 2026). I'm not an official STI service, and AI-generated answers can contain errors. When an AI provider is configured, your question and the retrieved handbook passages are sent to it. Without a key, the app runs in a clearly labelled local demo that only shows handbook excerpts.",
  greeting:
    "Hi! I'm STI Assist AI. I can help with school rules, ID and uniform policies, tardiness, gadgets, lost items, and other handbook topics. What would you like to know?",
  selfHarm:
    "I'm really sorry you're going through this. I can't provide crisis counseling, but you deserve immediate support. Please tell a trusted adult now — a parent or guardian, teacher, guidance counselor, or the school nurse. If you are in immediate danger, call local emergency services (911 in the Philippines) or go to the nearest emergency room. If you can, stay with someone you trust and avoid being alone. If this is about a friend, encourage them to speak with a trusted adult and stay with them if there is immediate danger.",
  selfHarmConcern:
    "I'm glad you're looking out for them. This needs support from a trusted adult right away — a parent or guardian, guidance counselor, teacher, or the school nurse. If your friend is in immediate danger, call local emergency services (911 in the Philippines) or go to the nearest emergency room. If you can do so safely, stay with them and encourage them to speak with a trusted adult. I'm a handbook assistant, not a crisis counselor.",
  threat:
    "This sounds like a safety emergency, so I won't treat it as an ordinary handbook question. Please move to a safe place and contact school security, a trusted school official, or local emergency services (911 in the Philippines) right away. If you can do so safely, tell them where you are and what you saw or heard. Do not confront anyone or handle a weapon yourself.",
  violence:
    "I can't help with hurting someone, threatening them, or avoiding getting caught. If you're dealing with a conflict, please talk to your guidance counselor, homeroom adviser, or the Assistant Principal. If someone is in immediate danger, contact school security or local emergency services right away.",
  weaponConcealment:
    "I can't help with hiding a weapon, sneaking one into campus, or getting around school security. The handbook treats carrying or possessing firearms, deadly weapons, and explosives as a major offense under Category D. If you have a safety concern, contact school security or a trusted school official. If there is an immediate threat, call local emergency services right away.",
  academicDishonesty:
    "I can't help with cheating, plagiarism, or avoiding detection. The handbook treats cheating as a major offense, and the related rules are in the discipline chapter. If you're struggling with schoolwork, talk to your teacher or guidance counselor. I can explain what the handbook says about academic honesty if that helps.",
  ruleEvasion:
    "I can't help with sneaking prohibited items into class, hiding them, or avoiding school rules. I can explain what the handbook says about the item or rule instead. Ask me a policy question such as \"What is the gadget policy?\" or \"What does the handbook say about vaping?\"",
});

/**
 * Classify a message before retrieval or AI generation.
 *
 * @param {string} rawMessage
 * @returns {{
 *   action: 'allow'|'guide',
 *   category: string,
 *   safetyLevel: 'none'|'caution'|'emergency',
 *   response: string|null,
 *   claimToVerify: boolean,
 *   weaponRelated: boolean,
 *   relatedSources: 'weapon'|'violence'|'cheating'|null,
 *   schoolTerms: string[],
 *   reason: string
 * }}
 */
export function analyseMessage(rawMessage) {
  const message = String(rawMessage || '').trim();
  const text = normalise(message);

  const base = {
    action: 'allow',
    category: 'school',
    safetyLevel: 'none',
    response: null,
    claimToVerify: false,
    weaponRelated: false,
    relatedSources: null,
    schoolTerms: [],
    reason: '',
  };

  if (!text) {
    return {
      ...base,
      action: 'guide',
      category: 'empty',
      response: 'Please type a question about school rules or campus concerns.',
      reason: 'empty message',
    };
  }

  // Safety-critical categories come first. These bypass retrieval and AI.
  if (anyMatch(SELF_HARM_CONCERN, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'self_harm_concern',
      safetyLevel: 'emergency',
      response: GUIDE_RESPONSES.selfHarmConcern,
      reason: 'concern about another person self-harm',
    };
  }

  if (anyMatch(SELF_HARM, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'self_harm',
      safetyLevel: 'emergency',
      response: GUIDE_RESPONSES.selfHarm,
      reason: 'self-harm or suicide language',
    };
  }

  if (anyMatch(THREAT, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'threat',
      safetyLevel: 'emergency',
      response: GUIDE_RESPONSES.threat,
      reason: 'possible imminent threat',
    };
  }

  if (anyMatch(VIOLENCE_INSTRUCTION, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'violence',
      safetyLevel: 'emergency',
      response: GUIDE_RESPONSES.violence,
      relatedSources: 'violence',
      reason: 'request for instructions to harm someone',
    };
  }

  if (anyMatch(WEAPON_CONCEALMENT, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'weapon_concealment',
      safetyLevel: 'emergency',
      response: GUIDE_RESPONSES.weaponConcealment,
      weaponRelated: true,
      relatedSources: 'weapon',
      reason: 'request to conceal a weapon or bypass security',
    };
  }

  if (anyMatch(ACADEMIC_DISHONESTY, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'academic_dishonesty',
      safetyLevel: 'caution',
      response: GUIDE_RESPONSES.academicDishonesty,
      relatedSources: 'cheating',
      reason: 'request for help cheating or avoiding detection',
    };
  }

  if (anyMatch(RULE_EVASION, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'rule_evasion',
      safetyLevel: 'caution',
      response: GUIDE_RESPONSES.ruleEvasion,
      relatedSources: 'gadget',
      reason: 'request to hide a prohibited item or avoid school rules',
    };
  }

  if (anyMatch(PROMPT_INJECTION, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'prompt_injection',
      safetyLevel: 'caution',
      response: GUIDE_RESPONSES.promptInjection,
      reason: 'attempt to override instructions or fabricate a policy',
    };
  }

  if (anyMatch(PERSONAL_DATA, text)) {
    return {
      ...base,
      action: 'guide',
      category: 'personal_data',
      response: GUIDE_RESPONSES.personalData,
      reason: 'request for personal records or credentials',
    };
  }

  if (META.some((pattern) => pattern.test(text))) {
    return {
      ...base,
      action: 'guide',
      category: 'meta',
      response: GUIDE_RESPONSES.meta,
      reason: 'question about the assistant',
    };
  }

  if (GREETING.test(text)) {
    return {
      ...base,
      action: 'guide',
      category: 'greeting',
      response: GUIDE_RESPONSES.greeting,
      reason: 'greeting or thanks',
    };
  }

  const schoolTerms = schoolTermHits(text);
  const hasSchoolTerm = schoolTerms.length > 0;
  const policyIntent = POLICY_INTENT.test(text);
  const weaponRelated = WEAPON_TERM.test(text);
  const violenceRelated = VIOLENCE_TERM.test(text);
  const claimToVerify = detectsClaimToVerify(text);

  // A pure math expression is never a handbook question.
  if (MATH_ONLY.test(text)) {
    return {
      ...base,
      action: 'guide',
      category: 'out_of_scope',
      response: GUIDE_RESPONSES.outOfScope,
      reason: 'pure calculation',
    };
  }

  // Reject clearly unrelated creative/coding/homework tasks unless the student
  // is actually asking about a policy (for example, the GenAI or homework rule).
  const generalTask =
    !policyIntent &&
    (CREATIVE_OR_CODE_TASK.test(text) ||
      HOMEWORK_TASK.test(text) ||
      (!hasSchoolTerm && GENERAL_TRIVIA.test(text)));

  if (generalTask) {
    return {
      ...base,
      action: 'guide',
      category: 'general_task',
      response: GUIDE_RESPONSES.generalTask,
      reason: 'general-purpose or homework task',
    };
  }

  if (!hasSchoolTerm) {
    return {
      ...base,
      action: 'guide',
      category: 'out_of_scope',
      response: GUIDE_RESPONSES.outOfScope,
      reason: 'no school-related terms found',
    };
  }

  // The student is asking whether a weapon is allowed, or what happens if one
  // is brought. This is a policy question, not a request for instructions.
  if (weaponRelated && anyMatch(WEAPON_POLICY, text)) {
    return {
      ...base,
      category: 'weapon_policy',
      safetyLevel: 'caution',
      weaponRelated: true,
      claimToVerify,
      schoolTerms,
      reason: 'weapon policy question',
    };
  }

  if (weaponRelated) {
    // A weapon is mentioned, but the question is not clearly a policy question
    // or a concealment request. Keep it in scope with a caution note so the
    // model does not volunteer dangerous instructions.
    return {
      ...base,
      category: 'weapon_related',
      safetyLevel: 'caution',
      weaponRelated: true,
      claimToVerify,
      schoolTerms,
      reason: 'weapon mentioned',
    };
  }

  if (violenceRelated) {
    return {
      ...base,
      category: 'violence_policy',
      safetyLevel: 'caution',
      claimToVerify,
      schoolTerms,
      reason: 'violence or conflict mentioned in a policy question',
    };
  }

  return {
    ...base,
    category: 'school',
    claimToVerify,
    schoolTerms,
    reason: 'school-related question',
  };
}

export function isSelfHarmConcern(rawMessage) {
  const text = normalise(rawMessage);
  return anyMatch(SELF_HARM_CONCERN, text) || anyMatch(SELF_HARM, text);
}

export const __testing = {
  normalise,
  schoolTermHits,
  detectsClaimToVerify,
};
