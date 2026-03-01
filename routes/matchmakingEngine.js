const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

const QUESTION_BANK = [
  { text: "What matters most in marriage?", pos: "Trust and respect", neg: "Only status and money", neu: "Shared goals", tagsPos: ["trust", "respect"], tagsNeg: ["material"], tagsNeu: ["goals"] },
  { text: "Preferred weekend style?", pos: "Family time", neg: "No involvement at home", neu: "Travel/social mix", tagsPos: ["family", "home"], tagsNeg: ["detached"], tagsNeu: ["social", "travel"] },
  { text: "How do you handle conflict?", pos: "Calm discussion", neg: "Shouting and blame", neu: "Take time then resolve", tagsPos: ["communication"], tagsNeg: ["anger"], tagsNeu: ["balanced"] },
  { text: "Cultural flexibility?", pos: "Open and respectful", neg: "Rigid and judgmental", neu: "Prefer same but flexible", tagsPos: ["inclusive"], tagsNeg: ["strict_filter"], tagsNeu: ["balanced"] },
  { text: "Financial planning style?", pos: "Joint planning", neg: "Single-person control", neu: "Discuss major decisions", tagsPos: ["finance", "teamwork"], tagsNeg: ["control"], tagsNeu: ["balanced"] },
  { text: "Career support after marriage?", pos: "Mutual growth support", neg: "One career should stop", neu: "Case-by-case support", tagsPos: ["growth", "support"], tagsNeg: ["restrictive"], tagsNeu: ["flexible"] },
  { text: "How do you value partner hobbies?", pos: "Encourage and join", neg: "Discourage differences", neu: "Respect separately", tagsPos: ["hobbies", "support"], tagsNeg: ["restrictive"], tagsNeu: ["neutral"] },
  { text: "View on family responsibilities?", pos: "Shared responsibilities", neg: "One-sided expectations", neu: "Discuss roles clearly", tagsPos: ["family", "teamwork"], tagsNeg: ["imbalance"], tagsNeu: ["clarity"] },
  { text: "How often should couples communicate daily?", pos: "Consistent meaningful communication", neg: "Ignore unless necessary", neu: "Moderate check-ins", tagsPos: ["communication"], tagsNeg: ["avoidance"], tagsNeu: ["balanced"] },
  { text: "How do you approach long-term goals?", pos: "Plan together yearly", neg: "No planning needed", neu: "Keep broad direction", tagsPos: ["goals", "planning"], tagsNeg: ["unplanned"], tagsNeu: ["flexible"] },
  { text: "Opinion on emotional expression?", pos: "Openly express feelings", neg: "Suppress all emotions", neu: "Share when necessary", tagsPos: ["emotional_intelligence"], tagsNeg: ["suppressed"], tagsNeu: ["balanced"] },
  { text: "Lifestyle preference after marriage?", pos: "Healthy routine and discipline", neg: "Irregular unhealthy habits", neu: "Flexible routine", tagsPos: ["health", "discipline"], tagsNeg: ["unhealthy"], tagsNeu: ["flexible"] },
  { text: "How to make major life decisions?", pos: "Mutual consent", neg: "One person final authority", neu: "Depends on decision type", tagsPos: ["consent", "teamwork"], tagsNeg: ["control"], tagsNeu: ["balanced"] },
  { text: "Opinion on personal space?", pos: "Healthy personal space is important", neg: "No individual space needed", neu: "Occasional space", tagsPos: ["space", "respect"], tagsNeg: ["overdependent"], tagsNeu: ["balanced"] },
  { text: "Approach to social circle after marriage?", pos: "Respect both circles", neg: "Cut off partner circle", neu: "Limited interaction", tagsPos: ["social", "respect"], tagsNeg: ["isolating"], tagsNeu: ["neutral"] },
  { text: "How should household work be managed?", pos: "Equal contribution", neg: "Only one partner should do all", neu: "Role-based but fair", tagsPos: ["equality", "teamwork"], tagsNeg: ["imbalance"], tagsNeu: ["balanced"] },
  { text: "How do you react to partner mistakes?", pos: "Supportive correction", neg: "Humiliate and criticize", neu: "Direct feedback", tagsPos: ["support", "respect"], tagsNeg: ["toxic"], tagsNeu: ["clarity"] },
  { text: "How important is honesty?", pos: "Absolute priority", neg: "Small lies are fine always", neu: "Context-based honesty", tagsPos: ["honesty", "trust"], tagsNeg: ["dishonesty"], tagsNeu: ["balanced"] },
  { text: "How do you handle stress?", pos: "Communicate and seek support", neg: "Take out anger on others", neu: "Need personal time first", tagsPos: ["stress_management", "communication"], tagsNeg: ["anger"], tagsNeu: ["space"] },
  { text: "Marriage expectation from partner?", pos: "Companionship and growth", neg: "Control and obedience", neu: "Practical partnership", tagsPos: ["companionship", "growth"], tagsNeg: ["control"], tagsNeu: ["practical"] },
];

const buildTemplateQuestions = (prefix, shift = 0) =>
  QUESTION_BANK.slice(0, 20).map((q, i) => ({
    id: `${prefix}_q_${i + 1}`,
    text: q.text,
    options: [
      { id: "a", label: q.pos, marks: 10 - (i % 3), tags: q.tagsPos },
      { id: "b", label: q.neg, marks: -5 + (shift % 2), tags: q.tagsNeg },
      { id: "c", label: q.neu, marks: 5 + (shift % 3), tags: q.tagsNeu },
    ],
  }));

const MATCHMAKING_PRESETS = [
  {
    id: "classic_marriage_v1",
    name: "Classic Marriage Compatibility (20Q)",
    description: "Traditional+balanced 20 inbuilt marriage questions.",
    questions: buildTemplateQuestions("classic", 0),
    scoring: { pass: 50, good: 70, best: 90 },
  },
  {
    id: "modern_partner_v1",
    name: "Modern Partner Fit (20Q)",
    description: "Modern values + emotional compatibility with 20 inbuilt questions.",
    questions: buildTemplateQuestions("modern", 1),
    scoring: { pass: 50, good: 70, best: 90 },
  },
];

const clampPercent = (value) => Math.max(0, Math.min(100, value));

const normalizeScoring = (raw) => {
  const pass = Number(raw?.pass ?? 50);
  const good = Number(raw?.good ?? 70);
  const best = Number(raw?.best ?? 90);
  return {
    pass: Math.max(0, Math.min(pass, 100)),
    good: Math.max(pass, Math.min(good, 100)),
    best: Math.max(good, Math.min(best, 100)),
  };
};

const normalizeTemplate = (template) => {
  const safeQuestions = Array.isArray(template?.questions) ? template.questions : [];
  const normalized = safeQuestions.map((q, qi) => {
    const qId = q?.id || `q_${qi + 1}`;
    const options = Array.isArray(q?.options) ? q.options : [];
    return {
      id: qId,
      text: String(q?.text || `Question ${qi + 1}`),
      options: options.map((opt, oi) => ({
        id: opt?.id || `o_${qi + 1}_${oi + 1}`,
        label: String(opt?.label || `Option ${oi + 1}`),
        marks: Number(opt?.marks || 0),
        tags: Array.isArray(opt?.tags) ? opt.tags.filter(Boolean).map((x) => String(x).toLowerCase()) : [],
      })),
    };
  });
  return {
    template_name: String(template?.template_name || "Custom Matchmaking Template"),
    selected_preset: String(template?.selected_preset || "custom"),
    questions: normalized,
    scoring: normalizeScoring(template?.scoring),
  };
};

const getBandFromPercent = (percentage, scoring) => {
  if (percentage >= scoring.best) return "best";
  if (percentage >= scoring.good) return "good";
  if (percentage >= scoring.pass) return "pass";
  return "needs_improvement";
};

const calculateMatchmakingScore = (template, answers) => {
  const normalized = normalizeTemplate(template);
  const answerMap = answers && typeof answers === "object" ? answers : {};
  let totalScore = 0;
  let maxScore = 0;
  const selectedTags = [];
  const answered = [];

  normalized.questions.forEach((q) => {
    const options = Array.isArray(q.options) ? q.options : [];
    const bestForQuestion = options.length
      ? Math.max(...options.map((o) => Number(o.marks || 0)), 0)
      : 0;
    maxScore += bestForQuestion;
    const selectedOptionId = answerMap[q.id];
    const selected = options.find((o) => String(o.id) === String(selectedOptionId));
    const marks = Number(selected?.marks || 0);
    totalScore += marks;
    if (selected?.tags?.length) {
      selectedTags.push(...selected.tags);
    }
    answered.push({
      question_id: q.id,
      selected_option_id: selected?.id || null,
      marks,
    });
  });

  const percentage = maxScore > 0 ? clampPercent((totalScore / maxScore) * 100) : 0;
  const band = getBandFromPercent(percentage, normalized.scoring);
  return {
    totalScore,
    maxScore,
    percentage: Number(percentage.toFixed(2)),
    band,
    tags: selectedTags,
    answered,
    scoring: normalized.scoring,
  };
};

const getTagProfile = (tags = []) => {
  const count = {};
  for (const tag of tags) {
    const key = String(tag || "").trim().toLowerCase();
    if (!key) continue;
    count[key] = (count[key] || 0) + 1;
  }
  const entries = Object.entries(count).sort((a, b) => b[1] - a[1]);
  return {
    topTags: entries.slice(0, 4).map(([name]) => name),
    map: count,
  };
};

const calculatePairCompatibility = (sourceTags = [], targetTags = [], sourcePct = 0, targetPct = 0) => {
  const a = new Set(sourceTags.map((x) => String(x || "").toLowerCase()).filter(Boolean));
  const b = new Set(targetTags.map((x) => String(x || "").toLowerCase()).filter(Boolean));
  const union = new Set([...a, ...b]);
  let intersectionCount = 0;
  for (const item of a) {
    if (b.has(item)) intersectionCount += 1;
  }
  const tagScore = union.size ? (intersectionCount / union.size) * 100 : 0;
  const scoreGap = Math.abs(Number(sourcePct || 0) - Number(targetPct || 0));
  const scoreAffinity = Math.max(0, 100 - scoreGap);
  return Number((tagScore * 0.7 + scoreAffinity * 0.3).toFixed(2));
};

const buildAiInsight = ({ score, percentage, band, tags, allSubmissions, currentUserId }) => {
  const profile = getTagProfile(tags);
  const peers = Array.isArray(allSubmissions) ? allSubmissions : [];
  const rankedPeers = peers
    .filter((x) => x.user_id !== currentUserId)
    .map((x) => ({
      user_id: x.user_id,
      user_name: x.user_name || "User",
      compatibility: calculatePairCompatibility(tags, x.tags || [], percentage, x.percentage),
      percentage: x.percentage,
      band: x.band,
      top_tags: getTagProfile(x.tags || []).topTags,
    }))
    .sort((a, b) => b.compatibility - a.compatibility)
    .slice(0, 3);

  let summary = "Profile under review.";
  if (band === "best") summary = "Excellent compatibility profile with strong balanced preferences.";
  else if (band === "good") summary = "Good compatibility profile; strong potential with aligned preferences.";
  else if (band === "pass") summary = "Pass profile; some areas can be improved for better match quality.";
  else summary = "Low compatibility score; revisit answers and discuss core expectations clearly.";

  return {
    summary,
    top_preference_tags: profile.topTags,
    score,
    percentage,
    band,
    top_peer_matches: rankedPeers,
  };
};

module.exports = {
  MATCHMAKING_PRESETS,
  deepClone,
  normalizeTemplate,
  calculateMatchmakingScore,
  buildAiInsight,
};

