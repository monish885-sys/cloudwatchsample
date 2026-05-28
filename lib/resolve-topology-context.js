/**
 * Phase 1 Direction Agent — deterministic service catalog routing (no LLM).
 */

/**
 * @param {import('./config.js').DependencyMap} dependencyMap
 * @returns {Map<string, import('./config.js').DependencyService>}
 */
export function indexDependencyServices(dependencyMap) {
  const byName = new Map();
  for (const group of dependencyMap?.groups || []) {
    for (const svc of group.services || []) {
      if (svc?.name) byName.set(svc.name, svc);
    }
  }
  return byName;
}

/**
 * @param {string} userQuery
 * @param {import('./config.js').DependencyMap} dependencyMap
 * @returns {import('./config.js').TopologyContext|null}
 */
export function resolveTopologyContext(userQuery, dependencyMap) {
  const text = (userQuery || '').toLowerCase();
  if (!text.trim()) return null;

  const byName = indexDependencyServices(dependencyMap);
  let best = null;
  let bestLen = 0;

  for (const svc of byName.values()) {
    for (const kw of svc.keywords || []) {
      const k = kw.toLowerCase();
      if (text.includes(k) && k.length > bestLen) {
        bestLen = k.length;
        best = svc;
      }
    }
  }

  if (!best) return null;

  const downstreamNames = [...(best.downstreamDependencies || [])];
  const scopedLogGroupPrefixes = uniquePrefixes([
    best.logGroupPrefix,
    ...downstreamNames.map((name) => byName.get(name)?.logGroupPrefix).filter(Boolean),
  ]);

  const knownInfrastructure = aggregateInfrastructure(byName, best.name, downstreamNames);

  return {
    primaryTarget: best.name,
    logGroupPrefix: best.logGroupPrefix,
    knownDownstreamDependencies: downstreamNames,
    knownInfrastructure,
    scopedLogGroupPrefixes,
  };
}

/**
 * @param {Map<string, import('./config.js').DependencyService>} byName
 * @param {string} primaryName
 * @param {string[]} downstreamNames
 */
function aggregateInfrastructure(byName, primaryName, downstreamNames) {
  const infra = new Set();
  const primary = byName.get(primaryName);
  for (const item of primary?.infrastructureDependencies || []) {
    infra.add(item);
  }
  for (const depName of downstreamNames) {
    const dep = byName.get(depName);
    for (const item of dep?.infrastructureDependencies || []) {
      infra.add(item);
    }
  }
  return [...infra];
}

/**
 * @param {string[]} prefixes
 */
function uniquePrefixes(prefixes) {
  const seen = new Set();
  const out = [];
  for (const p of prefixes) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Public topology slice for JSON schema 1.1 (no internal scan fields).
 * @param {import('./config.js').TopologyContext|null|undefined} ctx
 */
export function toTopologyPayload(ctx) {
  if (!ctx) return undefined;
  return {
    primaryTarget: ctx.primaryTarget,
    knownDownstreamDependencies: ctx.knownDownstreamDependencies,
    knownInfrastructure: ctx.knownInfrastructure,
  };
}
