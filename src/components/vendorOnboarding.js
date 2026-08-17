import { normalizePublicWebsiteUrl } from "../security/publicWebsiteUrl.js";

export const VENDOR_REGISTRATION_OPTIONS = Object.freeze([
  { id: "gstin", label: "GSTIN" },
  { id: "cin", label: "Corporate identity number (CIN)" },
  { id: "udyam", label: "Udyam registration" },
  { id: "not_registered", label: "No formal business registration" },
]);

const REGISTRATION_PATTERNS = Object.freeze({
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/u,
  cin: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/u,
  udyam: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/u,
});

const REGISTRATION_EXAMPLES = Object.freeze({
  gstin: "15-character GSTIN",
  cin: "21-character CIN",
  udyam: "UDYAM-XX-00-0000000",
});

const APPLICATION_LIMITS = Object.freeze({
  businessName: 140,
  legalName: 180,
  serviceAreas: 30,
  serviceAreaLength: 100,
  description: 3_000,
  phone: 24,
  websiteUrl: 300,
});

const EVIDENCE_URL_INPUT_MAX_LENGTH = 500;
const EVIDENCE_URL_NORMALIZED_MAX_LENGTH = 300;
const INSTAGRAM_HANDLE_PATTERN = /^@?[A-Za-z0-9._]{1,30}$/u;

function normalizedUniqueUrls(values) {
  return values.map((value) => normalizePublicWebsiteUrl(value)).filter(Boolean);
}

function validateUrlList(values, { minimum, maximum, label, field }) {
  const errors = {};
  const normalized = [];
  values.forEach((value, index) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      if (index < minimum) errors[`${field}.${index}`] = `Add ${label.toLowerCase()} ${index + 1}.`;
      return;
    }
    if (trimmed.length > EVIDENCE_URL_INPUT_MAX_LENGTH) {
      errors[`${field}.${index}`] = `Keep each evidence link to ${EVIDENCE_URL_INPUT_MAX_LENGTH} characters or fewer.`;
      return;
    }
    const url = normalizePublicWebsiteUrl(trimmed);
    if (!url) errors[`${field}.${index}`] = "Use a public https:// link; local, private and reserved destinations are not allowed.";
    else if (url.length > EVIDENCE_URL_NORMALIZED_MAX_LENGTH) {
      errors[`${field}.${index}`] = `Use a link that is ${EVIDENCE_URL_NORMALIZED_MAX_LENGTH} characters or fewer after normalization.`;
    } else normalized.push({ index, url });
  });
  const duplicateUrls = new Set();
  const seen = new Set();
  normalized.forEach(({ url }) => {
    if (seen.has(url)) duplicateUrls.add(url);
    seen.add(url);
  });
  normalized.forEach(({ index, url }) => {
    if (duplicateUrls.has(url)) errors[`${field}.${index}`] = "Use a different link for each evidence item.";
  });
  if (values.length > maximum) errors[field] = `Use no more than ${maximum} ${label.toLowerCase()}s.`;
  return errors;
}

export function evidenceFocusIndexAfterRemoval(itemCount, removedIndex) {
  const remainingCount = Math.max(0, Number(itemCount) - 1);
  if (!remainingCount) return null;
  return Math.min(Math.max(0, Number(removedIndex) || 0), remainingCount - 1);
}

export function canCompleteVendorEvidence(status, evidenceComplete) {
  return evidenceComplete !== true && ["pending", "rejected"].includes(status);
}

export function vendorEvidenceCompletionEligibility(vendor) {
  if (!vendor) return "no_application";
  if (vendor.evidenceComplete === true) return "complete";
  if (!["pending", "rejected"].includes(vendor.status)) return "status_unavailable";
  return "eligible";
}

export function validateVendorApplication(application) {
  const errors = {};
  const businessName = String(application?.businessName || "").trim();
  const legalName = String(application?.legalName || "").trim();
  const description = String(application?.description || "").trim();
  const phone = String(application?.phone || "").trim();
  const websiteUrl = String(application?.websiteUrl || "").trim();
  const instagramHandle = String(application?.instagramHandle || "").trim();
  const serviceAreas = Array.isArray(application?.serviceAreas)
    ? application.serviceAreas.map((item) => String(item || "").trim()).filter(Boolean)
    : String(application?.serviceAreas || "").split(",").map((item) => item.trim()).filter(Boolean);
  const minBudget = Number(application?.minBudget);
  const maxBudget = Number(application?.maxBudget);

  if (businessName.length < 2) errors.businessName = "Enter your trading name.";
  else if (businessName.length > APPLICATION_LIMITS.businessName) errors.businessName = `Keep the trading name to ${APPLICATION_LIMITS.businessName} characters or fewer.`;
  if (legalName.length < 2) errors.legalName = "Enter the registered or proprietor name.";
  else if (legalName.length > APPLICATION_LIMITS.legalName) errors.legalName = `Keep the registered or proprietor name to ${APPLICATION_LIMITS.legalName} characters or fewer.`;
  if (!application?.category) errors.category = "Choose a primary category.";
  if (!application?.city) errors.city = "Choose your home city.";
  if (!serviceAreas.length || serviceAreas.some((area) => area.length < 2)) errors.serviceAreas = "Add at least one service area.";
  else if (serviceAreas.length > APPLICATION_LIMITS.serviceAreas) errors.serviceAreas = `Use no more than ${APPLICATION_LIMITS.serviceAreas} service areas.`;
  else if (serviceAreas.some((area) => area.length > APPLICATION_LIMITS.serviceAreaLength)) errors.serviceAreas = `Keep every service area to ${APPLICATION_LIMITS.serviceAreaLength} characters or fewer.`;
  if (description.length < 80) errors.description = "Tell us about your work in at least 80 characters.";
  else if (description.length > APPLICATION_LIMITS.description) errors.description = `Keep the business introduction to ${APPLICATION_LIMITS.description.toLocaleString("en-IN")} characters or fewer.`;
  if (phone.length < 7) errors.phone = "Add a valid contact number.";
  else if (phone.length > APPLICATION_LIMITS.phone) errors.phone = `Keep the contact number to ${APPLICATION_LIMITS.phone} characters or fewer.`;
  if (!Number.isInteger(minBudget) || minBudget < 1_000) errors.minBudget = "Enter a whole-rupee typical starting amount of at least ₹1,000.";
  if (!Number.isInteger(maxBudget) || maxBudget < 1_000) errors.maxBudget = "Enter a whole-rupee typical maximum of at least ₹1,000.";
  else if (Number.isInteger(minBudget) && maxBudget < minBudget) errors.maxBudget = "Maximum must be at least the minimum.";
  if (websiteUrl.length > APPLICATION_LIMITS.websiteUrl) errors.websiteUrl = `Keep the website address to ${APPLICATION_LIMITS.websiteUrl} characters or fewer.`;
  else if (websiteUrl && !normalizePublicWebsiteUrl(websiteUrl)) errors.websiteUrl = "Use a public https:// website address; local and private destinations are not allowed.";
  if (instagramHandle && !INSTAGRAM_HANDLE_PATTERN.test(instagramHandle)) errors.instagramHandle = "Use up to 30 letters, numbers, periods or underscores, with an optional @.";

  return errors;
}

export function registrationReferenceError(type, value) {
  if (!type) return "Choose the business-registration evidence available.";
  if (type === "not_registered") return "";
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return `Enter the ${REGISTRATION_EXAMPLES[type] || "registration reference"}.`;
  if (!REGISTRATION_PATTERNS[type]?.test(normalized)) {
    return `Enter a valid ${REGISTRATION_EXAMPLES[type] || "registration reference"}.`;
  }
  return "";
}

export function validateVendorEvidence(evidence) {
  const portfolioUrls = Array.isArray(evidence?.portfolioUrls) ? evidence.portfolioUrls : [];
  const referenceUrls = Array.isArray(evidence?.referenceUrls) ? evidence.referenceUrls : [];
  const errors = {
    ...validateUrlList(portfolioUrls, { minimum: 1, maximum: 5, label: "Portfolio link", field: "portfolioUrls" }),
    ...validateUrlList(referenceUrls, { minimum: 1, maximum: 3, label: "Public reference link", field: "referenceUrls" }),
  };
  const normalizedPortfolio = portfolioUrls.map(normalizePublicWebsiteUrl);
  const normalizedReferences = referenceUrls.map(normalizePublicWebsiteUrl);
  const sharedUrls = new Set(normalizedPortfolio.filter((url) => url && normalizedReferences.includes(url)));
  normalizedPortfolio.forEach((url, index) => {
    if (sharedUrls.has(url)) errors[`portfolioUrls.${index}`] = "Use different links for work samples and public references.";
  });
  normalizedReferences.forEach((url, index) => {
    if (sharedUrls.has(url)) errors[`referenceUrls.${index}`] = "Use different links for work samples and public references.";
  });
  const registrationError = registrationReferenceError(evidence?.registrationType, evidence?.registrationReference);
  if (registrationError) errors[evidence?.registrationType ? "registrationReference" : "registrationType"] = registrationError;
  if (evidence?.attested !== true) errors.attested = "Confirm that the evidence is accurate, public and safe for the review team to open.";
  return errors;
}

export function buildVendorEvidence(evidence) {
  const registrationType = String(evidence?.registrationType || "");
  return {
    portfolioUrls: normalizedUniqueUrls(evidence?.portfolioUrls || []),
    referenceUrls: normalizedUniqueUrls(evidence?.referenceUrls || []),
    registrationType,
    ...(registrationType === "not_registered"
      ? {}
      : { registrationReference: String(evidence?.registrationReference || "").trim().toUpperCase() }),
    attested: evidence?.attested === true,
  };
}
