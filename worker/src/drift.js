// Population Stability Index (PSI) drift detection — plain JS, no stats
// library needed. Bin edges + per-bin proportions come from the training
// baseline (see model-service/train.py); live traffic gets bucketed into the
// same bins and compared.
const EPSILON = 1e-4;

function psiTerm(expected, actual) {
  const e = Math.max(expected, EPSILON);
  const a = Math.max(actual, EPSILON);
  return (a - e) * Math.log(a / e);
}

// Bin i covers (edges[i], edges[i+1]], except bin 0 which includes edges[0]
// (matches pandas.cut(..., include_lowest=True)). Values outside the training
// range clamp into the first/last bin rather than being dropped.
export function bucketIndex(edges, value) {
  if (value <= edges[0]) return 0;
  for (let i = 1; i < edges.length; i++) {
    if (value <= edges[i]) return i - 1;
  }
  return edges.length - 2;
}

export function scoreNumericFeature({ bin_edges: edges, bin_proportions: expected }, values) {
  const numeric = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (numeric.length === 0) return 0;

  const counts = new Array(expected.length).fill(0);
  for (const v of numeric) counts[bucketIndex(edges, v)] += 1;

  return expected.reduce((score, e, i) => score + psiTerm(e, counts[i] / numeric.length), 0);
}

export function scoreCategoricalFeature(baselineProportions, values) {
  const present = values.filter((v) => typeof v === "string" && v.length > 0);
  if (present.length === 0) return 0;

  const counts = {};
  for (const v of present) counts[v] = (counts[v] || 0) + 1;

  const categories = new Set([...Object.keys(baselineProportions), ...Object.keys(counts)]);
  let score = 0;
  for (const cat of categories) {
    score += psiTerm(baselineProportions[cat] || 0, (counts[cat] || 0) / present.length);
  }
  return score;
}

export function severityFor(score) {
  if (score >= 0.25) return "HIGH";
  if (score >= 0.1) return "MEDIUM";
  return "LOW";
}

// baseline: { numeric: { feature: { bin_edges, bin_proportions } }, categorical: { feature: { category: proportion } } }
// samples: array of feature objects (parsed telemetry.features_json)
export function computeDriftReport(baseline, samples) {
  const scores = {};
  for (const [feature, entry] of Object.entries(baseline.numeric || {})) {
    scores[feature] = scoreNumericFeature(entry, samples.map((s) => s[feature]));
  }
  for (const [feature, proportions] of Object.entries(baseline.categorical || {})) {
    scores[feature] = scoreCategoricalFeature(proportions, samples.map((s) => s[feature]));
  }

  const maxScore = Math.max(0, ...Object.values(scores));
  return { scores, max_severity: severityFor(maxScore) };
}
