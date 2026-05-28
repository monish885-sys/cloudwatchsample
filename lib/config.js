import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Load project `.env` when not already set (Cursor `envFile` still wins). */
function loadEnvFile() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq);
    const val = t.slice(eq + 1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

function envInt(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function expandPath(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

function envStr(key, fallback = '') {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : fallback;
}

export const config = {
  /** Bastion SSH target (MCP_JUMP_HOST) */
  jumpHost: envStr('MCP_JUMP_HOST'),
  /** Inner host from bastion (MCP_INNER_HOST) */
  innerHost: envStr('MCP_INNER_HOST'),
  /** Local key for bastion (MCP_SSH_KEY) */
  sshKey: expandPath(envStr('MCP_SSH_KEY')),
  /** Key path on bastion for inner hop (e.g. /tmp/ubuntu.pem) */
  innerSshKey: envStr('MCP_INNER_SSH_KEY', '/tmp/ubuntu.pem'),
  defaultLogPrefix: envStr(
    'MCP_LOG_PREFIX',
    envStr('MCP_DEFAULT_LOG_PREFIX', '/eks/prod/default/'),
  ),
  execTimeoutMs: envInt('MCP_EXEC_TIMEOUT_MS', 60000),
  maxBuffer: envInt('MCP_MAX_BUFFER', 10485760),
  scanParallel: envInt('MCP_SCAN_PARALLEL', 16),
  insightsBatchSize: envInt('MCP_INSIGHTS_BATCH_SIZE', 50),
  pipelineAppBudgetMs: envInt('MCP_PIPELINE_APP_BUDGET_MS', 90000),
  pipelineInfraBudgetMs: envInt('MCP_PIPELINE_INFRA_BUDGET_MS', 30000),
  pipelineTotalBudgetMs: envInt('MCP_PIPELINE_TOTAL_BUDGET_MS', 120000),
  maxOutputBytes: envInt('MCP_MAX_OUTPUT_BYTES', 51200),
  maxBlocks: envInt('MCP_MAX_BLOCKS', 10),
  maxSnippetBytes: envInt('MCP_MAX_SNIPPET_BYTES', 10240),
  scanMode: envStr('MCP_SCAN_MODE', 'auto'),
  serviceCatalogPath: envStr('MCP_SERVICE_CATALOG_PATH', './config/service-catalog.json'),
  dependencyMapPath: envStr('MCP_DEPENDENCY_MAP_PATH', './config/dependency-map.json'),
  k8sNamespace: envStr('MCP_K8S_NAMESPACE', 'default'),
  synthesisProfile: envStr('MCP_SYNTHESIS_PROFILE', ''),
  rootDir: ROOT,
};

export function loadServiceCatalog() {
  const path = resolve(ROOT, config.serviceCatalogPath.replace(/^\.\//, ''));
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * @typedef {Object} DependencyService
 * @property {string} name
 * @property {string[]} [keywords]
 * @property {string} logGroupPrefix
 * @property {string[]} [downstreamDependencies]
 * @property {string[]} [infrastructureDependencies]
 */

/**
 * @typedef {Object} DependencyMap
 * @property {number} version
 * @property {string} [defaultLogGroupPrefix]
 * @property {Array<{ id: string, label: string, services: DependencyService[] }>} groups
 */

/**
 * @typedef {Object} TopologyContext
 * @property {string} primaryTarget
 * @property {string} logGroupPrefix
 * @property {string[]} knownDownstreamDependencies
 * @property {string[]} knownInfrastructure
 * @property {string[]} scopedLogGroupPrefixes
 */

/** @type {DependencyMap|null} */
let cachedDependencyMap = null;

export function loadDependencyMap() {
  if (cachedDependencyMap) return cachedDependencyMap;
  const path = resolve(ROOT, config.dependencyMapPath.replace(/^\.\//, ''));
  const raw = readFileSync(path, 'utf8');
  cachedDependencyMap = JSON.parse(raw);
  return cachedDependencyMap;
}

/** @param {DependencyMap|null} map */
export function clearDependencyMapCache(map = null) {
  cachedDependencyMap = map;
}

export function getEffectiveCaps() {
  if (config.synthesisProfile === 'mini') {
    return {
      maxOutputBytes: 25600,
      maxBlocks: 5,
      maxSnippetBytes: config.maxSnippetBytes,
    };
  }
  return {
    maxOutputBytes: config.maxOutputBytes,
    maxBlocks: config.maxBlocks,
    maxSnippetBytes: config.maxSnippetBytes,
  };
}
