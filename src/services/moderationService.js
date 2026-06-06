// ─────────────────────────────────────────────────────────────
//  Content Moderation Service — 100% local, no API key needed
//
//  Detects abuse even when obfuscated via:
//   - Spaces between letters  (f u c k)
//   - Punctuation/symbols     (f.u.c.k  f*u*c*k)
//   - Repeated letters        (fuuuuck)
//   - Leetspeak               (f4ck  sh1t  @ss)
//   - Mixed case              (FuCk)
//   - Unicode lookalikes      (ƒuck)
//
//  Returns: { blocked, review, reason, severity, categories }
// ─────────────────────────────────────────────────────────────

const { Filter } = require('bad-words');
const filter = new Filter();

// ── Step 1: Normalize text to defeat obfuscation ─────────────
function normalize(text) {
  let t = text.toLowerCase();

  // Remove zero-width and invisible chars
  t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');

  // Leetspeak substitutions
  const leet = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
    '6': 'g', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', '$': 's', '!': 'i', '+': 't',
    '(': 'c', ')': 'd', '|': 'i', '¡': 'i',
    'ƒ': 'f', 'µ': 'u', '€': 'e', '£': 'l',
    'ß': 'ss', 'ð': 'd', 'þ': 'th',
  };
  t = t.split('').map(c => leet[c] || c).join('');

  // Remove separators between letters (f.u.c.k → fuck, f u c k → fuck)
  // Only collapse when pattern is single-char separated by non-alphanumeric
  t = t.replace(/\b([a-z])[^a-z0-9]{1,3}(?=[a-z]\b)/g, (_, c) => c);
  t = t.replace(/([a-z])\s([a-z])\s([a-z])/g, '$1$2$3');
  t = t.replace(/([a-z])\s([a-z])/g, '$1$2');

  // Collapse repeated letters (fuuuuck → fuck, shiiit → shit)
  t = t.replace(/(.)\1{2,}/g, '$1$1');

  // Remove remaining punctuation except spaces
  t = t.replace(/[^a-z0-9\s]/g, ' ');

  // Collapse multiple spaces
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

// ── Step 2: Pattern categories ────────────────────────────────

const PATTERNS = {

  // ── Threats & violence ──
  threats: [
    /\b(i('ll|'m going to| will| am going to)|gonna|going to)\s+(kill|murder|hurt|shoot|stab|attack|beat|destroy|end)\s+(you|u|him|her|them|everyone)\b/,
    /\b(kill|murder|hurt|shoot|stab|attack)\s+(yourself|urself|him|her|them|everyone|you)\b/,
    /\b(bomb|blow\s*up|explode|grenade|shoot\s*up)\s*(this|the|a|an)?\s*(place|school|building|crowd|event|wall)\b/,
    /\bdie\s+(slow|painfully|already|bitch)\b/,
    /\bi\s+want\s+(you|him|her|them)\s+(dead|to\s+die)\b/,
    /\byou\s+(are|r)\s+(dead|gonna\s+die)\b/,
  ],

  // ── Self-harm & suicide ──
  selfharm: [
    /\b(kill|hurt|harm|cut|end)\s+(my|your|ur)\s*(self|life|wrists?|existence)\b/,
    /\b(suicide|suicidal|kms|kys)\b/,
    /\bkill\s*(your|ur)\s*self\b/,
    /\bend\s*(it|my\s*life|your\s*life|everything)\b/,
    /\bwant\s+to\s+(die|end\s+it|disappear|not\s+exist)\b/,
    /\b(self[\s-]?harm|self[\s-]?destruct)\b/,
  ],

  // ── Hate speech ──
  hatespeech: [
    /\b(all|those?|these?|you)\s+(blacks?|whites?|jews?|muslims?|christians?|asians?|latinos?|hispanics?|gays?|lesbians?|trans)\s+(should|must|need\s+to|deserve\s+to)\s+(die|be\s+killed|be\s+gone|disappear)\b/,
    /\b(go\s+back\s+to|get\s+out\s+of)\s+(your|their)\s+(country|land)\b/,
    /\b(ethnic|racial)\s+cleansing\b/,
    /\bgenocide\b/,
    /\b(gas|burn|hang)\s+(the|all|those?)?\s*(jews?|blacks?|gays?|muslims?)\b/,
  ],

  // ── Harassment ──
  harassment: [
    /\byou\s+(are|r|'re)\s+(worthless|pathetic|disgusting|ugly|stupid|trash|garbage|nothing|a\s*(piece\s+of\s+)?waste|useless|a\s*loser)\b/,
    /\bno\s+one\s+(likes?|loves?|wants?|cares?\s*(about)?)\s+(you|u)\b/,
    /\byou\s+should\s+(not\s+exist|disappear|be\s+dead|never\s+have\s+been\s+born)\b/,
    /\bgo\s+(die|kill\s*yourself|hang)\b/,
    /\bkys\b/,
    /\b(loser|worthless|pathetic|disgusting)\s+(piece\s+of\s+)?(human|trash|garbage|crap|shit)\b/,
  ],

  // ── Sexual / explicit ──
  sexual: [
    /\b(send|show|give\s+me)\s+(nude|nudes|naked|pics|photos)\b/,
    /\b(want\s+to|wanna|gonna)\s+(f+u+c+k|have\s+sex\s+with|do\s+it\s+with)\s+(you|u|her|him)\b/,
    /\b(suck|lick|ride|bang)\s+(my|this)\s+(d+i+c+k|c+o+c+k|p+u+s+s+y|a+s+s)\b/,
    /\bp+o+r+n\b/,
    /\b(sex|sexual)\s+(assault|harass|abuse)\b/,
  ],

  // ── Dangerous content ──
  dangerous: [
    /\b(how\s+to|where\s+to|can\s+i)\s+(make|build|get|buy|obtain)\s+(a\s+)?(bomb|weapon|gun|drugs?|meth|cocaine|fentanyl)\b/,
    /\b(buy|sell|deal|score)\s+(meth|cocaine|heroin|fentanyl|crack|weed|drugs?)\b/,
    /\b(child|minor|kid|underage)\s+(sex|porn|nude|naked|molest|abuse)\b/,
    /\b(cp|csam|loli)\b/,
  ],

  // ── Spam ──
  spam: [
    /\b(follow|subscribe|check\s+out|visit|click)\s+(my|our|this)\s+(channel|page|profile|link|website|instagram|tiktok|onlyfans)\b/,
    /https?:\/\/\S+/,
    /www\.\S+\.\S+/,
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/,
    /(.)\1{4,}/, // aaaaaaa spam
  ],
};

// Profanity — mild words that get REVIEW not BLOCK
const REVIEW_WORDS = ['damn', 'hell', 'crap', 'ass', 'butt', 'piss', 'pee', 'fart', 'suck', 'idiot', 'stupid', 'dumb', 'moron'];

// ── Step 3: Check normalized text ────────────────────────────
function checkPatterns(normalized, original) {
  const results = [];

  for (const [category, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        results.push(category);
        break;
      }
    }
  }

  // Bad-words library (handles many variants automatically)
  try {
    if (filter.isProfane(normalized) || filter.isProfane(original.toLowerCase())) {
      if (!results.includes('profanity')) results.push('profanity');
    }
  } catch {}

  // Mild review words
  for (const word of REVIEW_WORDS) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(normalized)) {
      if (!results.includes('mild_language')) results.push('mild_language');
    }
  }

  return results;
}

// ── Step 4: Decision logic ────────────────────────────────────
function decide(categories) {
  const BLOCK_CATS = ['threats','selfharm','hatespeech','harassment','sexual','dangerous'];
  const REVIEW_CATS = ['profanity', 'mild_language'];

  for (const cat of BLOCK_CATS) {
    if (categories.includes(cat)) return 'BLOCK';
  }
  for (const cat of REVIEW_CATS) {
    if (categories.includes(cat)) return 'REVIEW';
  }
  return 'ALLOW';
}

function severity(categories) {
  if (['threats','selfharm','hatespeech','dangerous','sexual'].some(c => categories.includes(c))) return 'high';
  if (['harassment','profanity'].some(c => categories.includes(c))) return 'medium';
  return 'low';
}

function userReason(categories) {
  if (categories.includes('threats'))     return 'Message contains threatening language and cannot be posted.';
  if (categories.includes('selfharm'))    return 'Message contains sensitive content and cannot be posted.';
  if (categories.includes('hatespeech')) return 'Message contains hateful content and cannot be posted.';
  if (categories.includes('harassment')) return 'Message contains harassing content and cannot be posted.';
  if (categories.includes('sexual'))     return 'Message contains inappropriate content and cannot be posted.';
  if (categories.includes('dangerous'))  return 'Message contains unsafe content and cannot be posted.';
  if (categories.includes('spam'))       return 'Message looks like spam and cannot be posted.';
  if (categories.includes('profanity'))  return 'Message contains inappropriate language. Please keep it clean!';
  return 'Message was flagged and cannot be posted.';
}

// ── Main export ───────────────────────────────────────────────
async function moderateMessage(text) {
  const normalized  = normalize(text);
  const categories  = checkPatterns(normalized, text);
  const decision    = decide(categories);
  const sev         = severity(categories);

  console.log(`[mod] "${text.slice(0,40)}" → ${decision} [${categories.join(',')}]`);

  return {
    blocked:    decision === 'BLOCK',
    review:     decision === 'REVIEW',
    reason:     decision !== 'ALLOW' ? userReason(categories) : '',
    severity:   sev,
    categories,
    source:     'local',
  };
}

module.exports = { moderateMessage };
