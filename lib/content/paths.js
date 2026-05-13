const fs = require('fs');

const DEFAULT_EXTENSIONS = {
  directPlayCandidates: ['.mp4', '.m4v'],
  transcodeOnly: ['.mkv', '.avi', '.mov', '.ts', '.webm', '.wmv'],
};

const DEFAULT_EXCLUDE = ['sample', 'trailer', '_UNPACK_', '@eaDir', '.partial', '.DS_Store'];

function validateConfig(raw) {
  if (!raw || !Array.isArray(raw.paths)) {
    throw new Error('Invalid content config: missing or non-array `paths`');
  }
  for (const p of raw.paths) {
    if (!p.label || typeof p.label !== 'string') {
      throw new Error(`Invalid path entry: missing label (${JSON.stringify(p)})`);
    }
    if (!p.path || typeof p.path !== 'string') {
      throw new Error(`Invalid path entry: missing path (${JSON.stringify(p)})`);
    }
  }
}

function withDefaults(raw) {
  return {
    paths: raw.paths.map(p => ({
      label: p.label,
      path: p.path,
      newerThanDays: p.newerThanDays ?? null,
      recursive: p.recursive ?? true,
      type: p.type || 'auto',
    })),
    extensions: {
      directPlayCandidates: raw.extensions?.directPlayCandidates || DEFAULT_EXTENSIONS.directPlayCandidates,
      transcodeOnly: raw.extensions?.transcodeOnly || DEFAULT_EXTENSIONS.transcodeOnly,
    },
    excludePatterns: raw.excludePatterns || DEFAULT_EXCLUDE,
  };
}

/**
 * Load and validate content paths config. Returns null if the file is missing
 * (the feature is optional). Throws on invalid JSON or schema.
 */
function loadPathsConfig(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateConfig(raw);
  return withDefaults(raw);
}

module.exports = { loadPathsConfig, validateConfig, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDE };
