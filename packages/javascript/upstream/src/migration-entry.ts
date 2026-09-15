export { scanArcGisUsage, summarizeArcGisScan } from "./migration/scanner.js";
export type {
  ArcGisDependencyHit,
  ArcGisDependencyManifest,
  ArcGisDependencySection,
  ArcGisImportHit,
  ArcGisScanReport,
} from "./migration/scanner.js";
export {
  ARCGIS_WIDGET_DEPRECATION_RELEASE,
  ARCGIS_WIDGET_INVENTORY_PIN,
  ARCGIS_WIDGET_INVENTORY_SOURCE,
  ARCGIS_WIDGET_LIFECYCLE_STATEMENT,
  ARCGIS_WIDGET_REMOVAL_RELEASE,
  ARCGIS_WIDGET_REMOVAL_TIMEFRAME,
  getWidgetDisposition,
  WIDGET_DISPOSITION_DATA_VERSION,
  WIDGET_DISPOSITION_KINDS,
  WIDGET_DISPOSITIONS,
  WIDGET_SURVIVAL_GUIDE_PATH,
  widgetMigrationBucket,
  widgetModulePathInfo,
  widgetNameFromModulePath,
  widgetSurvivalGuideAnchor,
} from "./migration/widget-dispositions.js";
export type {
  ArcGisWidgetInventoryExclusion,
  ArcGisWidgetInventoryPin,
  WidgetDisposition,
  WidgetDispositionKind,
  WidgetMigrationBucket,
  WidgetModulePathInfo,
} from "./migration/widget-dispositions.js";
export {
  buildWidgetReadinessReport,
  evaluateWidgetGate,
  formatWidgetReadinessMarkdown,
  formatWidgetReadinessTable,
  scanWidgetUsage,
} from "./migration/widget-scanner.js";
export type {
  WidgetGateEvaluation,
  WidgetImportStyle,
  WidgetReadinessReport,
  WidgetReadinessRow,
  WidgetReadinessSummary,
  WidgetScanResult,
  WidgetUsageHit,
} from "./migration/widget-scanner.js";
export {
  MIGRATION_EVIDENCE_STATES,
  MIGRATION_MANIFEST_ARTIFACT_KIND,
  MIGRATION_MANIFEST_ARTIFACT_VERSION,
  MIGRATION_PARITY_EVIDENCE_ARTIFACT_KIND,
  MIGRATION_PARITY_EVIDENCE_ARTIFACT_VERSION,
  MIGRATION_SOURCE_INVENTORY_ARTIFACT_KIND,
  MIGRATION_SOURCE_INVENTORY_ARTIFACT_VERSION,
} from "./migration/contracts.js";
export type {
  MigrationCompatibilityAssessment,
  MigrationCutoverReadinessItem,
  MigrationCutoverReadinessSummary,
  MigrationEvidenceState,
  MigrationExternalDependency,
  MigrationInventoryAuthPosture,
  MigrationInventoryCodedValue,
  MigrationInventoryCompleteness,
  MigrationInventoryContainer,
  MigrationInventoryField,
  MigrationInventoryResource,
  MigrationInventoryScanRequest,
  MigrationInventorySourceKind,
  MigrationInventoryStyle,
  MigrationInventorySummary,
  MigrationManifestArtifact,
  MigrationManifestReviewItem,
  MigrationManifestStyleAction,
  MigrationManifestSummary,
  MigrationManifestTargetResource,
  MigrationParityEvidenceArtifact,
  MigrationParityEvidenceItem,
  MigrationParityEvidenceSection,
  MigrationReadinessAttestation,
  MigrationReadinessAttestationItem,
  MigrationSourceIdentity,
  MigrationSourceInventoryArtifact,
  MigrationSpatialReferenceInfo,
} from "./migration/contracts.js";
export { runEsriCompatCodemod } from "./migration/codemod.js";
export type {
  CodemodConstructorKind,
  CodemodTarget,
  CodemodFileResult,
  CodemodKindMetrics,
  CodemodMetrics,
  CodemodMetricsByKind,
  EsriCompatCodemodOptions,
  EsriCompatCodemodResult,
  MigrationTodo,
} from "./migration/codemod.js";
export { SUPPORTED_ARCGIS_MODULES } from "./migration/codemod.js";
export { buildJsMigrationReport } from "./migration/report.js";
export type {
  ArcGisModuleSummary,
  ArcGisUsageInventory,
  ArcGisUsageStyle,
  JsConversionMode,
  JsConversionModeAssessment,
  JsConversionPlan,
  JsFileBoundary,
  JsFileDiagnostic,
  JsFileDiagnosticCode,
  JsFileMigration,
  JsMigrationReport,
  ManualInterventionMetric,
  ManualRewriteMetric,
  MigrationGateResult,
  MigrationReadiness,
  MigrationReasonSummary,
  WidgetRuntime,
  WidgetRuntimeRequirement,
} from "./migration/report.js";
export {
  HONUA_COMPAT_BUNDLER_WORKAROUND_DEPENDENCIES,
  HONUA_COMPAT_RUNTIME_DEPENDENCIES,
  JS_MIGRATION_PIPELINE_REPORT_SCHEMA_VERSION,
  JS_MIGRATION_PLAN_SCHEMA_VERSION,
  SDK_JS_OPTIONAL_GRPC_PEERS_ISSUE,
  applyJsMigration,
  createUnifiedDiff,
  planJsMigration,
} from "./migration/pipeline.js";
export type {
  JsConfigReference,
  JsDependencyChange,
  JsDependencyChangeAction,
  JsMigrationApplyOptions,
  JsMigrationPipelineReport,
  JsMigrationPlan,
  JsMigrationPlanOptions,
  JsPipelineStage,
  JsPipelineStageName,
  JsPipelineStageStatus,
  JsPipelineVerdict,
  JsPlanHold,
  JsResidualWorkItem,
  JsResidualWorkSource,
  JsSourceChange,
} from "./migration/pipeline.js";
export { evaluateMigrationGates } from "./migration/gating.js";
export type { MigrationGateEvaluation, MigrationGateOptions } from "./migration/gating.js";
export { runLayerReconciliation, summarizeLayerReconciliation } from "./migration/reconcile.js";
export type { LayerReconciliationOptions, LayerReconciliationReport } from "./migration/reconcile.js";
export {
  parseGeoservicesServiceUrl,
  runGeoservicesImportJob,
  runMigrationDemo,
} from "./migration/demo.js";
export type {
  GeoservicesImportJobReport,
  GeoservicesImportStageOptions,
  MigrationDemoOptions,
  MigrationDemoReport,
  ParsedGeoservicesServiceUrl,
} from "./migration/demo.js";
export {
  runContentScan,
  runContentExport,
  runContentImport,
  runContentReconcile,
} from "./migration/content.js";
export type {
  ContentPortalItemSummary,
  ContentScanOptions,
  ContentScanReport,
  ExportedWebMap,
  ExportedHostedLayerEntry,
  ExportedHostedService,
  ContentExportManifest,
  ContentExportOptions,
  ContentExportReport,
  ImportedHostedLayerReport,
  ImportedWebMapReport,
  ContentImportOptions,
  ContentImportReport,
  ReconciledHostedLayerReport,
  ReconciledWebMapReport,
  ContentReconcileOptions,
  ContentReconcileReport,
} from "./migration/content.js";
export {
  analyzeEsriSampleFixture,
  classifyArcGisServiceUrl,
  extractEsriSampleReferences,
  loadEsriSampleCorpusManifest,
  parseEsriSampleCorpusManifest,
  summarizeEsriSampleCorpus,
} from "./migration/sample-corpus.js";
export type {
  ArcGisServiceKind,
  ArcGisServiceReference,
  EsriSampleCorpusGuardrails,
  EsriSampleCorpusLane,
  EsriSampleCorpusManifest,
  EsriSampleCorpusSample,
  EsriSampleCorpusSampleStatus,
  EsriSampleCorpusSchemaVersion,
  EsriSampleCorpusSummary,
  EsriSampleExpectedReferences,
  EsriSampleFixtureAnalysis,
  EsriSampleFixtureReference,
  EsriSampleGuardrailFlag,
  EsriSampleLicenseMetadata,
  EsriSampleReferenceExtraction,
  EsriSampleSkipReason,
  EsriSampleSourceReference,
  EsriSampleTermsMetadata,
  PortalItemReference,
} from "./migration/sample-corpus.js";
export {
  buildEsriSampleCorpusEvidence,
  emitEsriSampleCorpusEvidence,
} from "./migration/sample-corpus-evidence.js";
export type {
  BuildEsriSampleCorpusEvidenceOptions,
  EmitEsriSampleCorpusEvidenceOptions,
  EsriSampleCorpusEvidence,
  EsriSampleEvidenceAggregate,
  EsriSampleEvidenceClassification,
  EsriSampleEvidenceManualTodoReason,
  EsriSampleEvidenceManualTodos,
  EsriSampleEvidenceRecord,
  EsriSampleEvidenceStatus,
  EsriSampleEvidenceStatusCounts,
  EsriSampleEvidenceUrlRewriteSummary,
} from "./migration/sample-corpus-evidence.js";
export {
  MIGRATION_DEMO_FALLBACK_TARGET,
  MIGRATION_DEMO_ISSUE_NUMBER,
  MIGRATION_DEMO_PRIMARY_TARGET,
  MIGRATION_DEMO_TARGETS,
} from "./migration/demo-targets.js";
export type { MigrationDemoFixtureTarget } from "./migration/demo-targets.js";
export { getJsParityMatrix, JS_PARITY_MATRIX, summarizeJsParityMatrix } from "./migration/parity-matrix.js";
export type {
  JsParityCategory,
  JsParityMatrixEntry,
  JsParityMatrixKind,
  JsParityStatus,
  JsParitySummary,
} from "./migration/parity-matrix.js";
export {
  getJsRuntimeParityMatrix,
  JS_RUNTIME_PARITY_MATRIX,
  summarizeJsRuntimeParity,
} from "./migration/runtime-matrix.js";
export type {
  JsRuntimeParityEntry,
  JsRuntimeParityStatus,
  JsRuntimeParitySurface,
  JsRuntimeParitySummary,
} from "./migration/runtime-matrix.js";
