import { SCENE_IDS } from './scenes.js';

const COMBAT_WORDS = /\b(?:attack|battle|combat|fight|initiative|kill|slay|stab|strike|weapon|sword|ambush|charge)\w*\b/i;
const META_CONTEXT = /\b(?:last\s+(?:week|session|time)|previously|recap|remember\s+when|out\s+of\s+character|ooc|rules?\s+(?:question|check|discussion)|attack\s+roll|armor\s+class|mechanic(?:ally|s)?|hypothetical|for\s+example)\b/i;
const COMBAT_NEGATION = /\b(?:not|isn['’]?t|aren['’]?t|weren['’]?t|without|avoid(?:ing)?|no)\b[^.!?]{0,35}\b(?:combat|battle|fight(?:ing)?|attack(?:ing)?)\b|\b(?:combat|battle|the\s+fight)\s+(?:is|was)\s+(?:over|finished|done)\b/i;
const REPORTED_THREAT = /\b(?:says?|said|reads?|read|wrote|writes?|whispers?|shouts?|yells?|threatens?)\b[^.!?]{0,100}\b(?:kill|attack|fight|die|destroy|slay)\w*\b/i;
const SCENE_END = /\b(?:scene\s+(?:ends?|is\s+over)|cut\s+to\s+black|fade\s+out|take\s+(?:a\s+)?(?:short\s+)?break|session\s+break|combat\s+is\s+over|the\s+fight\s+(?:ends?|is\s+over)|everyone\s+falls\s+silent)\b/i;
const EXPLICIT_COMBAT = /\b(?:(?:roll|role)\s+(?:for\s+)?initiative|the\s+(?:fight|battle|combat)\s+(?:begins?|starts?|erupts?)|we\s+(?:enter|start|begin)\s+(?:combat|battle)|they\s+(?:attack|charge|ambush)\s+(?:us|you|the\s+party)|swords?\s+(?:are\s+)?drawn)\b/i;
const HISTORICAL_CONTEXT = /\b(?:last\s+(?:week|session|time)|previously|earlier\s+in\s+the\s+campaign|in\s+the\s+recap)\b/i;
const CONDITIONAL_COMBAT = /\b(?:if|unless|would|could|might|should|before|after|when)\b[^.!?]{0,100}\b(?:(?:roll|role)\s+(?:for\s+)?initiative|attack(?:s|ed|ing)?|combat|battle|fight(?:ing)?)\b/i;
const NEGATED_INITIATIVE = /\b(?:do\s+not|don['’]?t|not|never|no\s+need\s+to)\b[^.!?]{0,45}\b(?:roll|role)\s+(?:for\s+)?initiative\b|\b(?:roll|role)\s+(?:for\s+)?initiative\b[^.!?]{0,30}\b(?:later|yet|not\s+now)\b/i;
const DEPICTED_WEAPONS = /\b(?:painting|portrait|mural|banner|tapestry|statue|carving|illustration|sign|story|song)\b[^.!?]{0,80}\bswords?\s+(?:are\s+)?drawn\b|\bswords?\s+(?:are\s+)?drawn\b[^.!?]{0,80}\b(?:on|in)\s+(?:a|the)\s+(?:painting|portrait|mural|banner|tapestry|statue|carving|illustration|sign|story)\b/i;

const CUES = Object.freeze({
  quiet: [
    [/\b(?:silence|silent|stillness|quiet|calm|empty\s+room|nothing\s+happens)\b/i, 1.5],
    [/\b(?:pause|intermission|aftermath)\b/i, 0.8]
  ],
  rest: [
    [/\b(?:campfire|camp|sanctuary|shelter|safe\s+haven|inn|bedroll)\b/i, 1.2],
    [/\b(?:short\s+rest|long\s+rest|rest(?:ing)?|sleep|recover|heal(?:ing)?)\b/i, 1.5],
    [/\b(?:warm\s+fire|stew|settle\s+in)\b/i, 0.9]
  ],
  travel: [
    [/\b(?:travel|journey|road|trail|path|march|trek|caravan|voyage)\w*\b/i, 1.25],
    [/\b(?:forest|woods|mountain|valley|river|wilderness|explor(?:e|ing|ation))\b/i, 0.9],
    [/\b(?:ride|sail|walk)\s+(?:on|through|toward|to|across)\b/i, 0.8]
  ],
  social: [
    [/\b(?:tavern|market|festival|feast|court|ballroom|village|town|shop)\b/i, 1.2],
    [/\b(?:negotiate|conversation|parley|banter|gossip|celebrate|toast|crowd)\w*\b/i, 0.95],
    [/\b(?:speak|talk|ask|bargain)\s+(?:with|to)\b/i, 0.7]
  ],
  mystery: [
    [/\b(?:investigat|search|clue|secret|mystery|evidence|footprint|cipher|riddle)\w*\b/i, 1.25],
    [/\b(?:strange|uncanny|hidden|unknown|whisper|ritual|symbol|locked\s+door)\w*\b/i, 0.8],
    [/\b(?:what\s+happened|something\s+is\s+wrong)\b/i, 0.9]
  ],
  danger: [
    [/\b(?:danger|threat|tense|tension|peril|pursuit|chased|stalked|trap|alarm)\w*\b/i, 1.25],
    [/\b(?:creeping|approaching|surrounded|cornered|hostile|menacing)\b/i, 0.9],
    [/\b(?:draws?\s+near|closing\s+in|on\s+your\s+heels)\b/i, 0.9]
  ],
  combat: [
    [/\b(?:combat|battle|fight(?:ing)?|melee|skirmish)\b/i, 1.3],
    [/\b(?:attack(?:s|ed|ing)?|strike(?:s|ing)?|stab(?:s|bed|bing)?|shoot(?:s|ing)?|casts?\s+\w+\s+at)\b/i, 1.15],
    [/\b(?:initiative|hit\s+points?|saving\s+throw|bloodied)\b/i, 0.8]
  ],
  wonder: [
    [/\b(?:wonder|awe|majestic|miracle|celestial|otherworldly|breathtaking)\b/i, 1.3],
    [/\b(?:magic|magical|ancient|portal|revelation|floating|glowing)\w*\b/i, 0.85],
    [/\b(?:for\s+the\s+first\s+time|reveals?\s+itself)\b/i, 0.7]
  ],
  sorrow: [
    [/\b(?:grief|sorrow|mourn|funeral|loss|lament|tragic|heartbreak)\w*\b/i, 1.35],
    [/\b(?:weeps?|cries|tears|fallen\s+friend|memorial|regret)\b/i, 1.0],
    [/\b(?:somber|melancholy|heavy\s+silence)\b/i, 0.85]
  ],
  victory: [
    [/\b(?:victory|triumph|victorious|we\s+won|enemy\s+is\s+defeated)\b/i, 1.5],
    [/\b(?:cheers?|celebration|heroes?|raise\s+a\s+glass|quest\s+complete)\b/i, 0.95]
  ]
});

function normalize(text) {
  return String(text ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function suppressedResult(text, reason) {
  return {
    text,
    scene: null,
    confidence: 0,
    force: false,
    suppressed: true,
    evidence: [],
    reason
  };
}

export function classifyScene(input) {
  const text = normalize(input);
  if (!text) {
    return {
      text,
      scene: null,
      confidence: 0,
      force: false,
      suppressed: false,
      evidence: [],
      reason: 'silence'
    };
  }

  if ((COMBAT_WORDS.test(text) || SCENE_END.test(text))
      && (META_CONTEXT.test(text) || HISTORICAL_CONTEXT.test(text))) {
    return suppressedResult(text, 'combat language occurred in recap, rules, or out-of-character context');
  }

  if (COMBAT_NEGATION.test(text) || NEGATED_INITIATIVE.test(text)) {
    return suppressedResult(text, 'combat language was negated or described as over');
  }

  if (CONDITIONAL_COMBAT.test(text)) {
    return suppressedResult(text, 'conditional combat language is not an active scene change');
  }

  if (REPORTED_THREAT.test(text) && !/\b(?:lunges?|swings?|fires?|charges?)\s+(?:at|toward)\b/i.test(text)) {
    return suppressedResult(text, 'a reported or quoted threat is not active combat');
  }

  if (DEPICTED_WEAPONS.test(text)) {
    return suppressedResult(text, 'depicted weapons are not active combat');
  }

  if (SCENE_END.test(text)) {
    return {
      text,
      scene: 'quiet',
      confidence: 0.99,
      force: true,
      suppressed: false,
      evidence: ['explicit scene ending'],
      reason: 'explicit scene ending'
    };
  }

  if (EXPLICIT_COMBAT.test(text)) {
    return {
      text,
      scene: 'combat',
      confidence: 0.99,
      force: true,
      suppressed: false,
      evidence: ['explicit active-combat cue'],
      reason: 'explicit active-combat cue'
    };
  }

  const scores = new Map(SCENE_IDS.map((scene) => [scene, 0]));
  const evidence = new Map(SCENE_IDS.map((scene) => [scene, []]));

  for (const [scene, patterns] of Object.entries(CUES)) {
    for (const [pattern, weight] of patterns) {
      const match = text.match(pattern);
      if (match) {
        scores.set(scene, scores.get(scene) + weight);
        evidence.get(scene).push(match[0]);
      }
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [scene, score] = ranked[0];
  const runnerUp = ranked[1][1];
  if (score < 0.75) {
    return {
      text,
      scene: null,
      confidence: 0.2,
      force: false,
      suppressed: false,
      evidence: [],
      reason: 'no clear scene cue'
    };
  }

  const margin = Math.max(0, score - runnerUp);
  const confidence = Math.min(0.96, 0.43 + score * 0.19 + margin * 0.08);
  return {
    text,
    scene,
    confidence: Number(confidence.toFixed(2)),
    force: false,
    suppressed: false,
    evidence: evidence.get(scene),
    reason: `${scene} cues: ${evidence.get(scene).join(', ')}`
  };
}
