// Accuracy/precision/recall/F1 from labeled predictions — plain confusion-
// matrix math, no library needed.
// rows: array of { prediction: 0|1, actual: 0|1 }
export function computePerformance(rows) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const { prediction, actual } of rows) {
    if (prediction === 1 && actual === 1) tp += 1;
    else if (prediction === 0 && actual === 0) tn += 1;
    else if (prediction === 1 && actual === 0) fp += 1;
    else if (prediction === 0 && actual === 1) fn += 1;
  }

  const accuracy = rows.length > 0 ? (tp + tn) / rows.length : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { accuracy, precision, recall, f1 };
}
