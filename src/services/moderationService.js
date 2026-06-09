// ─────────────────────────────────────────────────────────────
//  Content Moderation Service — 100% local, no API key needed
//
//  Detects obfuscated abuse:
//   - Leetspeak:    sh1t k1ll @ss
//   - Spaced chars: f u c k (only single chars separated by spaces)
//   - Punctuation:  f.u.c.k  f*u*c*k
//   - Repeats:      fuuuuck
// ─────────────────────────────────────────────────────────────

const BadWords = require('bad-words');
const filter   = new BadWords();

// ── Normalize ────────────────────────────────────────────────
function normalize(text) {
  let t = text.toLowerCase();

  // Remove invisible chars
  t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');

  // Leetspeak
  const leet = {
    '0':'o','1':'i','3':'e','4':'a','5':'s','6':'g','7':'t','8':'b','9':'g',
    '@':'a','$':'s','!':'i','+':'t','(':'c',')':'d','|':'i',
    'ƒ':'f','µ':'u','€':'e','£':'l',
  };
  t = t.split('').map(c => leet[c] || c).join('');

  // Collapse ONLY single chars separated by spaces: "f u c k" → "fuck"
  // Pattern: non-word-char OR start, then (single-letter space)+ single-letter
  t = t.replace(/(?<![a-z])([a-z])\s(?=[a-z](?:\s[a-z])*(?:\s|$))/g, (match, ch) => ch);
  // Run twice to catch overlapping
  t = t.replace(/(?<![a-z])([a-z])\s(?=[a-z](?:\s[a-z])*(?:\s|$))/g, (match, ch) => ch);

  // Remove punctuation separators between single letters: f.u.c.k → fuck
  t = t.replace(/\b([a-z])[.\-*_~|\\\/]{1,2}([a-z])\b/g, '$1$2');

  // Collapse repeated letters (fuuuuck → fuuck)
  t = t.replace(/(.)\1{2,}/g, '$1$1');

  return t.trim();
}

// ── Patterns ─────────────────────────────────────────────────
const PATTERNS = {

  threats: [
    /\b(gonna|going to|will|i'll)\s+(kill|murder|hurt|shoot|stab|attack)\s+(you|u|him|her|them|everyone)\b/,
    /\b(kill|murder|shoot|stab)\s+(yourself|urself)\b/,
    /\b(bomb|blow up|shoot up)\s+(this|the)?\s*(place|school|building|event)\b/,
    /\bdie\s+(slow|painfully|already)\b/,
    /\bi want (you|him|her) (dead|to die)\b/,
  ],

  selfharm: [
    /\b(kill|hurt|harm|cut|end)\s+(my|your|ur)\s*(self|life|wrists?)\b/,
    /\b(suicide|suicidal)\b/,
    /\bkms\b/,
    /\bkys\b/,
    /\bwant to (die|end it|not exist)\b/,
    /\bself[\s-]?harm\b/,
  ],

  hatespeech: [
    /\b(ethnic|racial)\s+cleansing\b/,
    /\bgenocide\b/,
    /\b(gas|burn|hang)\s+(the\s+)?(jews|blacks|gays|muslims)\b/,
    /\b(all)?\s*(blacks|jews|muslims|gays)\s+(should|must|deserve to)\s+(die|be killed)\b/,
  ],

  harassment: [
    /\byou\s+(are|r|re)\s+(worthless|pathetic|disgusting|ugly|stupid|trash|garbage|useless|a loser|a waste)\b/,
    /\b(worthless|pathetic|disgusting)\s+(trash|garbage|piece)\b/,
    /\bno one\s+(likes|loves|wants|cares about)\s+(you|u)\b/,
    /\byou should (not exist|disappear|be dead)\b/,
    /\bgo (die|hang)\b/,
    /\bkys\b/,
  ],

  sexual: [
    /\b(send|show|give me)\s+(nude|nudes|naked|pics|photos)\b/,
    /\b(wanna|gonna|want to)\s+(fuck|have sex)\s+(you|u|her|him)\b/,
    /\bsend (me )?(your )?(dick|pussy|ass)\s*(pic|photo|pic)?\b/,
    /\bporn\b/,
    /\b(sex|sexual)\s+(assault|harass|abuse)\b/,
    /\bonlyfans\b/,
  ],

  dangerous: [
    /\b(how to|where to|can i)\s+(make|build|buy)\s+(a\s+)?(bomb|weapon|drugs|meth|cocaine|fentanyl)\b/,
    /\b(buy|sell|deal|score)\s+(meth|cocaine|heroin|fentanyl|crack)\b/,
    /\b(child|minor|kid|underage)\s+(sex|porn|nude|molest|abuse)\b/,
    /\b(cp|csam|loli)\b/,
  ],

  spam: [
    /\b(follow|subscribe|check out|visit)\s+(my|our)\s+(channel|page|profile|website|instagram|tiktok)\b/,
    /https?:\/\/[^\s]+/,
    /www\.[a-z0-9-]+\.[a-z]{2,}/,
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/,
    /(.)\1{5,}/,
  ],
};

// Words that trigger REVIEW (not BLOCK)
const REVIEW_WORDS = ['damn','hell','crap','ass','butt','piss','fart','idiot','stupid','dumb','moron'];

// ── Check ────────────────────────────────────────────────────
function checkPatterns(normalized, original) {
  const results = [];

  for (const [category, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized) || pattern.test(original.toLowerCase())) {
        if (!results.includes(category)) results.push(category);
        break;
      }
    }
  }

  // bad-words library
  try {
    if (filter.isProfane(normalized) || filter.isProfane(original.toLowerCase())) {
      if (!results.includes('profanity')) results.push('profanity');
    }
  } catch {}

  // Mild words → REVIEW
  for (const word of REVIEW_WORDS) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(normalized) && !results.includes('mild_language')) {
      results.push('mild_language');
    }
  }

  return results;
}

// ── Decision ─────────────────────────────────────────────────
function decide(categories) {
  const BLOCK  = ['threats','selfharm','hatespeech','harassment','sexual','dangerous'];
  const REVIEW = ['profanity','mild_language','spam'];
  for (const c of BLOCK)  if (categories.includes(c)) return 'BLOCK';
  for (const c of REVIEW) if (categories.includes(c)) return 'REVIEW';
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
  if (categories.includes('hatespeech'))  return 'Message contains hateful content and cannot be posted.';
  if (categories.includes('harassment'))  return 'Message contains harassing content and cannot be posted.';
  if (categories.includes('sexual'))      return 'Message contains inappropriate content and cannot be posted.';
  if (categories.includes('dangerous'))   return 'Message contains unsafe content and cannot be posted.';
  if (categories.includes('spam'))        return 'Message looks like spam and cannot be posted.';
  if (categories.includes('profanity'))   return 'Message contains inappropriate language. Please keep it clean!';
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
