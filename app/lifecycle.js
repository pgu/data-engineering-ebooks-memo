// Data engineering lifecycle + undercurrents (after "Fundamentals of Data Engineering", fig. 2-7).
// Used by the graph view to place Topics / Technologies tags in meaningful zones.
// Edit OVERRIDES or RULES to re-classify a tag; keys/regexes are matched on the lower-cased label.

// Layout in a 1400 × 1000 design space centred on (0, 0). Books float in the band between rows.
export const ZONES = [
  // Lifecycle (top)
  { id: 'generation', label: 'Generation', group: 'Lifecycle', color: '#d98b98', rect: [-700, -440, 190, 300] },
  { id: 'ingestion', label: 'Ingestion', group: 'Lifecycle', color: '#3f9a63', rect: [-480, -500, 290, 210] },
  { id: 'transformation', label: 'Transformation', group: 'Lifecycle', color: '#9b3fd0', rect: [-180, -500, 290, 210] },
  { id: 'serving', label: 'Serving', group: 'Lifecycle', color: '#2f63c0', rect: [120, -500, 290, 210] },
  { id: 'storage', label: 'Storage', group: 'Lifecycle', color: '#8d8d93', rect: [-480, -280, 890, 150] },
  { id: 'consumption', label: 'Analytics · ML · Reverse ETL', group: 'Lifecycle', color: '#c9a400', rect: [440, -500, 260, 370] },
  // Undercurrents (bottom)
  // `desc` = the author's definition (fig. 2-7), shown as a tooltip on the zone.
  { id: 'security', label: 'Security', group: 'Undercurrents', color: '#9b3fd0', rect: [-700, 230, 225, 270],
    desc: 'Access control to data and systems' },
  { id: 'management', label: 'Data management', group: 'Undercurrents', color: '#5a95c8', rect: [-465, 230, 225, 270],
    desc: 'Data governance (discoverability, definitions, accountability) · Data modeling · Data integrity' },
  { id: 'dataops', label: 'DataOps', group: 'Undercurrents', color: '#c9a400', rect: [-230, 230, 225, 270],
    desc: 'Data governance · Observability and monitoring · Incident reporting (plus automation: CI/CD, IaC, deployment)' },
  { id: 'architecture', label: 'Data architecture', group: 'Undercurrents', color: '#3f9a63', rect: [5, 230, 225, 270],
    desc: 'Analyze trade-offs · Design for agility · Add value to the business' },
  { id: 'orchestration', label: 'Orchestration', group: 'Undercurrents', color: '#d0607a', rect: [240, 230, 225, 270],
    desc: 'Coordinate workflows · Schedule jobs · Manage tasks' },
  { id: 'softeng', label: 'Software engineering', group: 'Undercurrents', color: '#d98a3d', rect: [475, 230, 225, 270],
    desc: 'Programming and coding skills · Software design patterns · Testing and debugging' },
  // Fallback
  { id: 'other', label: 'Other / platforms', group: 'Other', color: '#8d8d93', rect: [-700, -90, 160, 260] },
];
export const ZONE = Object.fromEntries(ZONES.map((z) => [z.id, z]));
// Books are kept in this band (between the two rows, right of the "Other" box).
export const BOOK_BAND = { x: [-520, 700], y: [-110, 190] };

// Exact matches win over rules.
const OVERRIDES = {
  // topics
  'de lifecycle': 'architecture',
  lifecycle: 'architecture',
  'undercurrents (security, dataops, orchestration)': 'architecture',
  'people & processes': 'architecture',
  'enterprise data practice': 'architecture',
  'real-time intelligence': 'serving',
  'real-time analytics': 'serving',
  'warehouses & compute': 'storage',
  warehouse: 'storage',
  'data warehouse': 'storage',
  'relational dw': 'storage',
  'modern dw': 'architecture',
  'storage & retrieval': 'storage',
  'data models': 'management',
  'data value': 'management',
  'data flow': 'orchestration', // sequencing / fan-in / fan-out of pipelines = coordinate workflows
  'data factory': 'orchestration',
  // Per fig. 2-7 definitions:
  'delta live tables': 'transformation', // declarative pipeline framework, not a scheduler
  'data value': 'transformation', // enrichment/decoration patterns
  validation: 'management', // data integrity
  'lake formation': 'security', // fine-grained access control
  cost: 'architecture', // analyze trade-offs
  pricing: 'architecture',
  'performance & cost': 'architecture',
  performance: 'transformation', // query / job optimization
  'performance tuning': 'transformation',
  'error management': 'softeng',
  idempotency: 'softeng',
  'getting started': 'other',
  workspaces: 'other',
  'delta lake acid & schema evolution': 'storage',
  'building apps': 'softeng',
  'data sharing': 'serving',
  'remote data': 'ingestion',
  'migration to aws': 'architecture',
  transactions: 'storage',
  replication: 'storage',
  partitioning: 'storage',
  encoding: 'storage',
  'distributed systems': 'architecture',
  'big data': 'architecture',
  eda: 'consumption',
  visualization: 'consumption',
  ml: 'consumption',
  'data for ai': 'consumption',
  'relational entities': 'storage',
  'parquet/csv/json': 'storage',
  json: 'storage',
  'importing data': 'ingestion',
  'data contracts': 'management',
  'data products': 'architecture',
  // technologies
  'microsoft fabric': 'other',
  'azure databricks': 'other',
  databases: 'storage',
  sql: 'softeng',
  python: 'softeng',
  'spark notebooks': 'softeng',
  jupysql: 'softeng',
  'databricks sql': 'serving',
  'sql database': 'storage',
  athena: 'serving',
  'apache pinot': 'serving',
  'apache xtable': 'storage',
  agents: 'consumption',
  dataflow: 'transformation',
  'glue data catalog': 'management',
  postgresql: 'generation', // operational source system
  snowflake: 'storage',
  redshift: 'storage',
  bigquery: 'storage',
  mirroring: 'ingestion',
  'data pipelines': 'orchestration',
  'analytics engineer role': 'consumption',
};

// First match wins.
const RULES = [
  ['security', /secur|access control|\biam\b|encrypt|privacy/],
  ['consumption', /\bml\b|machine learning|sagemaker|bedrock|gen ?ai|agentic|\bagents?\b|\bllm|\brag\b|cortex|reverse etl|\bai\b/],
  ['management', /governance|catalog|quality|expectation|contract|lineage|discover|lake formation|dataplex|deequ|model(l)?ing|star schema|data vault|\bscd\b|one-big-table|historization|semantic model|schema evolution|integrity/],
  ['dataops', /monitor|observab|ci\/cd|devops|dataops|deploy|asset bundles|\biac\b|incident|administration|\bcost\b|pricing|performance|tuning|maintenance|production pipelines|automation/],
  ['orchestration', /orchestrat|airflow|dagster|composer|step functions|workflow|schedul/],
  ['architecture', /architect|lakehouse|medallion|bronze|silver|gold|mesh|data fabric|platform design|landing zone|design pattern|design session|interoperab/],
  ['serving', /serving|power bi|direct lake|looker|tabular editor|semantic link|\bdax\b|\bbi\b|graphql/],
  ['ingestion', /ingest|kafka|event hubs|pub\/sub|stream|real-time|\bcdc\b|auto loader|snowpipe|incremental|loads|watermark|elt vs etl/],
  ['storage', /storage|delta lake|iceberg|hudi|parquet|table format|\bs3\b|onelake|data lake|warehouse|duckdb|motherduck|postgres|in-process/],
  ['transformation', /transform|spark|flink|\bdbt\b|\betl\b|glue|dataproc|\bemr\b|compute|processing|validation|polars|snowpark/],
  ['softeng', /python|\bsql\b|programming|notebook|\bapi\b|testing|debug/],
];

export function zoneOf(label) {
  const key = label.toLowerCase();
  if (OVERRIDES[key]) return OVERRIDES[key];
  for (const [zone, re] of RULES) if (re.test(key)) return zone;
  return 'other';
}

export const zoneCenter = (z) => [z.rect[0] + z.rect[2] / 2, z.rect[1] + z.rect[3] / 2 + 12];
