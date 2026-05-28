/**
 * Determine if scan should use Insights engine for broad mode.
 * @param {'exact'|'insights'|'auto'} scanMode
 */
export function shouldUseInsights(scanMode) {
  return scanMode === 'insights' || scanMode === 'auto';
}
