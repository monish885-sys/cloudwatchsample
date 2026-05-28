/**
 * @param {Array<{ score: number }>} topBlocks
 * @param {{ correlated?: boolean }} infrastructureContext
 */
export function computeConfidence(topBlocks, infrastructureContext = {}) {
  const aggregateScore = topBlocks.length ? Math.max(...topBlocks.map((b) => b.score)) : 0;

  if (aggregateScore >= 100 || (aggregateScore >= 50 && infrastructureContext.correlated)) {
    return 'HIGH';
  }
  if (aggregateScore >= 30 && aggregateScore <= 99) {
    return 'MEDIUM';
  }
  return 'LOW';
}
