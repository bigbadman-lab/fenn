/**
 * Editorial package validators — re-export quality gate API.
 */
export {
  assertNoInventedStats,
  assessEditorialPackage,
  detectBannedMarketing,
  detectGenericCrypto,
  EDITORIAL_BAD_FIXTURES,
  EDITORIAL_GOOD_FIXTURES,
  nearKey,
  normalizeBody,
  openingPhrase,
  validateEditorialPackage,
  validateEditorialPackageStructure,
  validateSingleTransmission,
  type EditorialQualityAssessment,
  type EditorialQualityFailure,
} from "@/lib/editorial/quality";
