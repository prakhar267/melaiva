const REQUEST_SUBMISSION_STORAGE_KEY = "melaiva:request-publish:v2";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_STORED_PAYLOAD_LENGTH = 24_000;

const eventTypeLabels = new Map([
  ["wedding", "Wedding"],
  ["engagement", "Engagement"],
  ["reception", "Reception"],
  ["anniversary", "Anniversary"],
  ["family_celebration", "Family celebration"],
  ["other", "Other"],
]);

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localDateTimeValue(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function boundedSafeText(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !UNSAFE_TEXT_PATTERN.test(value)
    ? value
    : null;
}

function preferredVendorFromRecord(payload, value) {
  const preferredVendorId = payload?.preferredVendorId;
  if (!preferredVendorId) return value === null || value === undefined ? null : undefined;
  if (!isPlainRecord(value) || value.id !== preferredVendorId) return undefined;
  const id = SAFE_IDENTIFIER_PATTERN.test(value.id || "") ? value.id : null;
  const slug = typeof value.slug === "string" && /^[a-z0-9-]{2,80}$/u.test(value.slug) ? value.slug : null;
  const name = boundedSafeText(value.name, 160);
  const categoryLabel = boundedSafeText(value.categoryLabel, 100);
  const city = boundedSafeText(value.city, 100);
  const initials = typeof value.initials === "string" && /^[\p{L}\p{M}\p{N}]{1,6}$/u.test(value.initials) ? value.initials : null;
  const tone = ["marigold", "rose", "teal", "aubergine"].includes(value.tone) ? value.tone : null;
  if (!id || !slug || !name || !categoryLabel || !city || !initials || !tone) return undefined;
  return { id, slug, name, categoryLabel, city, initials, tone };
}

function sameJsonValue(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function boundedRejectionMessage(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 500
    && !UNSAFE_TEXT_PATTERN.test(value)
    ? value
    : "This publish was definitively rejected.";
}

export function requestPreferredVendorInitials(value) {
  const tokens = typeof value === "string" ? value.trim().split(/\s+/u).filter(Boolean) : [];
  const tokenInitials = tokens
    .map((token) => [...token].find((character) => /[\p{L}\p{N}]/u.test(character)))
    .filter(Boolean);
  const fallback = [...String(value || "")].filter((character) => /[\p{L}\p{N}]/u.test(character));
  return (tokenInitials.length ? tokenInitials : fallback).slice(0, 2).join("") || "VP";
}

export function requestDraftFromPayload(payload) {
  if (!isPlainRecord(payload)) return null;
  const eventType = eventTypeLabels.get(payload.eventType);
  const biddingEndsAt = localDateTimeValue(payload.biddingEndsAt);
  if (
    typeof payload.title !== "string"
    || !eventType
    || typeof payload.eventDate !== "string"
    || typeof payload.city !== "string"
    || !Number.isSafeInteger(payload.guestCount)
    || !Number.isSafeInteger(payload.budgetMin)
    || !Number.isSafeInteger(payload.budgetMax)
    || payload.currency !== "INR"
    || !Array.isArray(payload.categories)
    || payload.categories.length !== 1
    || typeof payload.categories[0] !== "string"
    || typeof payload.requirements !== "string"
    || !biddingEndsAt
    || (payload.preferredVendorId !== undefined && typeof payload.preferredVendorId !== "string")
  ) return null;

  return {
    title: payload.title,
    eventType,
    eventDate: payload.eventDate,
    city: payload.city,
    guestCount: String(payload.guestCount),
    categories: [...payload.categories],
    budgetMin: String(payload.budgetMin),
    budgetMax: String(payload.budgetMax),
    biddingEndsAt,
    requirements: payload.requirements,
  };
}

export function validateRequestDraft(draft, now = Date.now()) {
  const errorsByStep = { 1: {}, 2: {}, 3: {} };
  const title = typeof draft?.title === "string" ? draft.title.trim() : "";
  const eventType = typeof draft?.eventType === "string" ? draft.eventType.trim() : "";
  const eventDate = typeof draft?.eventDate === "string" ? draft.eventDate.trim() : "";
  const city = typeof draft?.city === "string" ? draft.city.trim() : "";
  const guestCount = Number(draft?.guestCount);
  const categories = Array.isArray(draft?.categories) ? draft.categories : [];
  const budgetMin = Number(draft?.budgetMin);
  const budgetMax = Number(draft?.budgetMax);
  const biddingEndsAt = typeof draft?.biddingEndsAt === "string" ? draft.biddingEndsAt.trim() : "";
  const biddingEndsAtTime = Date.parse(biddingEndsAt);
  const eventStartTime = Date.parse(`${eventDate}T00:00:00`);
  const eventEndTime = Date.parse(`${eventDate}T23:59:59`);
  const requirements = typeof draft?.requirements === "string" ? draft.requirements.trim() : "";

  if (title.length < 5) errorsByStep[1].title = "Add a request name of at least 5 characters.";
  else if (title.length > 120) errorsByStep[1].title = "Keep the request name to 120 characters or fewer.";
  if (!eventType || eventType.length > 60) errorsByStep[1].eventType = "Choose the celebration type.";
  if (!eventDate) errorsByStep[1].eventDate = "Choose an approximate date.";
  else if (!Number.isFinite(eventEndTime) || eventEndTime <= now) errorsByStep[1].eventDate = "Choose a future celebration date.";
  if (!city || city.length > 100) errorsByStep[1].city = "Choose a city.";
  if (!Number.isSafeInteger(guestCount) || guestCount < 20) errorsByStep[1].guestCount = "Enter at least 20 guests.";
  else if (guestCount > 5_000) errorsByStep[1].guestCount = "Enter no more than 5,000 guests.";

  if (categories.length !== 1 || typeof categories[0] !== "string" || categories[0].trim().length < 2 || categories[0].trim().length > 50) errorsByStep[2].categories = "Choose one service for this request.";

  if (!Number.isSafeInteger(budgetMin) || budgetMin < 10_000) errorsByStep[3].budgetMin = "Enter a whole-number starting budget of at least 10,000.";
  if (!Number.isSafeInteger(budgetMax) || budgetMax <= budgetMin) errorsByStep[3].budgetMax = "Maximum must be a whole number higher than the minimum.";
  if (!biddingEndsAt || !Number.isFinite(biddingEndsAtTime) || biddingEndsAtTime <= now) {
    errorsByStep[3].biddingEndsAt = "Choose a future closing time.";
  } else if (Number.isFinite(eventStartTime) && biddingEndsAtTime >= eventStartTime) {
    errorsByStep[3].biddingEndsAt = "The offer window must close before the celebration date.";
  }
  if (requirements.length < 30) errorsByStep[3].requirements = "Add at least 30 characters so partners can respond meaningfully.";
  else if (requirements.length > 1_500) errorsByStep[3].requirements = "Keep the brief to 1,500 characters or fewer.";

  const firstInvalidStep = [1, 2, 3].find((step) => Object.keys(errorsByStep[step]).length > 0) || null;
  return {
    errors: Object.assign({}, errorsByStep[1], errorsByStep[2], errorsByStep[3]),
    errorsByStep,
    firstInvalidStep,
  };
}

export function rejectedRequestEditStep(draft, { responseWindowEnded = false, now = Date.now() } = {}) {
  const firstInvalidStep = validateRequestDraft(draft, now).firstInvalidStep;
  if (firstInvalidStep && firstInvalidStep < 3) return firstInvalidStep;
  if (responseWindowEnded) return 3;
  return firstInvalidStep || 1;
}

export function pendingSubmissionBelongsToUser(submission, userId) {
  return Boolean(submission)
    && SAFE_IDENTIFIER_PATTERN.test(userId || "")
    && submission.ownerUserId === userId;
}

export function readPendingRequestSubmission(storage, now = Date.now()) {
  let raw;
  try {
    raw = storage?.getItem(REQUEST_SUBMISSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw || raw.length > MAX_STORED_PAYLOAD_LENGTH) return null;

  try {
    const record = JSON.parse(raw);
    const createdAt = Date.parse(record?.createdAt);
    const state = record?.state;
    const validAge = Number.isFinite(createdAt)
      && createdAt <= now + MAX_CLOCK_SKEW_MS
      && (state === "rejected" || createdAt > now - MAX_PENDING_AGE_MS);
    const draft = requestDraftFromPayload(record?.payload);
    const preferredVendor = preferredVendorFromRecord(record?.payload, record?.preferredVendor);
    if (
      record?.version !== 2
      || !["pending", "rejected"].includes(state)
      || !IDEMPOTENCY_KEY_PATTERN.test(record?.key || "")
      || !SAFE_IDENTIFIER_PATTERN.test(record?.ownerUserId || "")
      || !validAge
      || !draft
      || preferredVendor === undefined
    ) {
      storage?.removeItem(REQUEST_SUBMISSION_STORAGE_KEY);
      return null;
    }
    return {
      key: record.key,
      ownerUserId: record.ownerUserId,
      payload: record.payload,
      draft,
      preferredVendor,
      createdAt: record.createdAt,
      state,
      rejectionMessage: state === "rejected" ? boundedRejectionMessage(record.rejectionMessage) : null,
    };
  } catch {
    try { storage?.removeItem(REQUEST_SUBMISSION_STORAGE_KEY); } catch { /* Ignore unavailable tab storage. */ }
    return null;
  }
}

export function writePendingRequestSubmission(storage, {
  key,
  ownerUserId,
  payload,
  preferredVendor = null,
  createdAt,
}, now = Date.now()) {
  if (
    !storage?.setItem
    || !IDEMPOTENCY_KEY_PATTERN.test(key || "")
    || !SAFE_IDENTIFIER_PATTERN.test(ownerUserId || "")
    || !requestDraftFromPayload(payload)
  ) return false;
  const normalizedVendor = preferredVendorFromRecord(payload, preferredVendor);
  if (normalizedVendor === undefined) return false;

  const existing = readPendingRequestSubmission(storage, now);
  if (existing && (existing.state !== "pending" || (
    existing.key !== key
    || existing.ownerUserId !== ownerUserId
    || !sameJsonValue(existing.payload, payload)
    || !sameJsonValue(existing.preferredVendor, normalizedVendor)
  ))) return false;

  const firstAttemptAt = existing?.createdAt || createdAt || new Date(now).toISOString();
  const firstAttemptTime = Date.parse(firstAttemptAt);
  if (
    !Number.isFinite(firstAttemptTime)
    || firstAttemptTime > now + MAX_CLOCK_SKEW_MS
    || firstAttemptTime <= now - MAX_PENDING_AGE_MS
  ) return false;

  try {
    storage.setItem(REQUEST_SUBMISSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      key,
      ownerUserId,
      payload,
      preferredVendor: normalizedVendor,
      createdAt: new Date(firstAttemptTime).toISOString(),
      state: "pending",
    }));
    return true;
  } catch {
    return false;
  }
}

export function markPendingRequestSubmissionRejected(storage, submission, rejectionMessage, now = Date.now()) {
  const existing = readPendingRequestSubmission(storage, now);
  if (
    !existing
    || existing.state !== "pending"
    || existing.key !== submission?.key
    || existing.ownerUserId !== submission?.ownerUserId
    || !sameJsonValue(existing.payload, submission?.payload)
    || !sameJsonValue(existing.preferredVendor, submission?.preferredVendor || null)
  ) return false;
  try {
    storage.setItem(REQUEST_SUBMISSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      key: existing.key,
      ownerUserId: existing.ownerUserId,
      payload: existing.payload,
      preferredVendor: existing.preferredVendor,
      createdAt: existing.createdAt,
      state: "rejected",
      rejectionMessage: boundedRejectionMessage(rejectionMessage),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingRequestSubmission(storage) {
  try { storage?.removeItem(REQUEST_SUBMISSION_STORAGE_KEY); } catch { /* Ignore unavailable tab storage. */ }
}
