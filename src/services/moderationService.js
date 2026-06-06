// ─────────────────────────────────────────────────────────────
//  AI Content Moderation Service
//  Uses Claude API to review messages before they appear on wall
//
//  moderateMessage(text) → { blocked, review, reason, cleaned }
//
//  Decision logic:
//    ALLOW  → post immediately
//    REVIEW → hold, notify moderators via socket
//    BLOCK  → reject with reason shown to user
//
//  Falls back to basic regex if API is unavailable
// ─────────────────────────────────────────────────────────────

const MODERATION_PROMPT = `You are a content moderation engine for a public event message wall displayed on a large screen in front of an audience.

Task:
Review the input message and decide whether it contains abusive, hateful, harassing, threatening, sexually explicit, self-harm, violent, spam, or otherwise unsafe language.

Rules:
- Be strict but fair.
- Focus on intent, not just exact keywords.
- Detect obfuscated abuse including spaces between letters, punctuation between letters, repeated letters, leetspeak, unicode substitutions, emojis, and misspellings.
- Normalize the text before analysis.
- Do not flag harmless educational, quoted, or clearly non-abusive usage.
- If the text is borderline or unclear, choose REVIEW.
- If clearly safe, choose ALLOW.

Output valid JSON only, no markdown, no explanation:
{
  "decision": "ALLOW" | "REVIEW" | "BLOCK",
  "categories": [],
  "severity": "low" | "medium" | "high",
  "reason": "",
  "cleaned_text": ""
}`;

// ── AI moderation via Claude API ──────────────────────────────
async function moderateWithAI(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // fall back to regex

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001', // fast + cheap for moderation
        max_tokens: 256,
        system:     MODERATION_PROMPT,
        messages:   [{ role: 'user', content: `Input message:\n"""\n${text}\n"""` }],
      }),
    });

    if (!response.ok) {
      console.error('Moderation API error:', response.status);
      return null;
    }

    const data   = await response.json();
    const raw    = data.content?.[0]?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return parsed;
  } catch (err) {
    console.error('AI moderation failed, falling back to regex:', err.message);
    return null;
  }
}

// ── Regex fallback (when API unavailable) ────────────────────
const leoProfanity = require('leo-profanity');

const NEGATIVE_PATTERNS = [
  /\bkill\s*(your|ur)\s*self\b/i, /\bkys\b/i, /\bgo\s*(die|hang)\b/i,
  /\byou\s*(are|r|'re)\s*(worthless|pathetic|disgusting|ugly|stupid|a\s*loser|trash|garbage|nothing|a\s*waste)\b/i,
  /\bno\s*one\s*(likes|loves|wants|cares\s*about)\s*you\b/i,
  /\byou\s*should\s*(die|not\s*exist|disappear|end\s*it)\b/i,
];

const HARMFUL_PATTERNS = [
  /\b(i('ll|\s*will|\s*am\s*going\s*to)|gonna)\s*(kill|shoot|stab|bomb|attack|hurt|murder)\b/i,
  /\b(suicide|suicidal)\b/i,
  /\bend\s*(my|your|their)\s*life\b/i,
  /\bself[\s-]?harm\b/i,
];

function regexModerate(text) {
  if (leoProfanity.check(text)) {
    return { decision: 'BLOCK', reason: 'Message contains profanity or abusive language.', severity: 'medium', categories: ['profanity'] };
  }
  for (const p of NEGATIVE_PATTERNS) {
    if (p.test(text)) return { decision: 'BLOCK', reason: 'Message contains hostile or harmful sentiments.', severity: 'high', categories: ['harassment'] };
  }
  for (const p of HARMFUL_PATTERNS) {
    if (p.test(text)) return { decision: 'BLOCK', reason: 'Message contains threatening or harmful content.', severity: 'high', categories: ['violence'] };
  }
  return { decision: 'ALLOW', reason: '', severity: 'low', categories: [] };
}

// ── Main export ───────────────────────────────────────────────
async function moderateMessage(text) {
  // Try AI first
  const aiResult = await moderateWithAI(text);

  if (aiResult) {
    console.log(`[moderation] AI: ${aiResult.decision} | ${aiResult.categories?.join(',')} | "${text.slice(0, 40)}"`);
    return {
      blocked:  aiResult.decision === 'BLOCK',
      review:   aiResult.decision === 'REVIEW',
      reason:   aiResult.decision === 'BLOCK'
                  ? userFriendlyReason(aiResult.categories)
                  : aiResult.reason,
      cleaned:  aiResult.cleaned_text || text,
      severity: aiResult.severity,
      categories: aiResult.categories || [],
      source:   'ai',
    };
  }

  // Regex fallback
  const result = regexModerate(text);
  console.log(`[moderation] regex: ${result.decision} | "${text.slice(0, 40)}"`);
  return {
    blocked:    result.decision === 'BLOCK',
    review:     false,
    reason:     result.reason,
    cleaned:    text,
    severity:   result.severity,
    categories: result.categories,
    source:     'regex',
  };
}

function userFriendlyReason(categories = []) {
  if (categories.includes('hate_speech'))    return 'Message contains hateful content and cannot be posted.';
  if (categories.includes('threats'))        return 'Message contains threatening language and cannot be posted.';
  if (categories.includes('sexual'))         return 'Message contains inappropriate content and cannot be posted.';
  if (categories.includes('self_harm'))      return 'Message contains sensitive content and cannot be posted.';
  if (categories.includes('harassment'))     return 'Message contains harassing content and cannot be posted.';
  if (categories.includes('violence'))       return 'Message contains violent content and cannot be posted.';
  if (categories.includes('spam'))           return 'Message looks like spam and cannot be posted.';
  if (categories.includes('profanity'))      return 'Message contains inappropriate language and cannot be posted.';
  return 'Message was flagged as unsafe and cannot be posted.';
}

module.exports = { moderateMessage };
