import { cities } from "../data.js";

export const PLANNER_HANDOFF_STATE_KEY = "melaivaPlannerRequestHandoff";

const HANDOFF_KIND = "melaiva.planner-request-handoff";
const HANDOFF_VERSION = 1;
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
const HANDOFF_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_CONSTRAINTS_LENGTH = 1000;
const MAX_REQUIREMENTS_LENGTH = 1500;

const plannerCities = new Set(cities);
const plannerStyles = new Set([
  "Contemporary Indian",
  "Heritage & regal",
  "Garden romance",
  "Minimal & modern",
  "Coastal ease",
  "Intimate at home",
]);
const plannerCeremonies = new Set([
  "Engagement",
  "Haldi",
  "Mehendi",
  "Sangeet",
  "Wedding",
  "Reception",
]);
const plannerPriorities = new Set([
  "Guest experience",
  "Food",
  "Design & decor",
  "Photography",
  "Entertainment",
  "Low-waste choices",
]);

const handoffKeys = [
  "kind",
  "version",
  "createdAt",
  "eventDate",
  "city",
  "guestCount",
  "style",
  "ceremonies",
  "priorities",
  "constraints",
];

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nowTimestamp(now) {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number") return now;
  if (typeof now === "string") return new Date(now).getTime();
  return Number.NaN;
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isCanonicalIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isFutureIsoDate(value, timestamp) {
  const date = new Date(timestamp);
  const localDate = new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return isCanonicalIsoDate(value) && value > localDate;
}

function normalizeGuestCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const guestCount = Number(value);
  return Number.isInteger(guestCount) && guestCount >= 20 && guestCount <= 5000 ? guestCount : null;
}

function isExactUniqueList(value, allowed, { min = 0 } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= allowed.size
    && value.every((item) => typeof item === "string" && allowed.has(item))
    && new Set(value).size === value.length;
}

function hasExactHandoffKeys(value) {
  const keys = Object.keys(value);
  return keys.length === handoffKeys.length && handoffKeys.every((key) => keys.includes(key));
}

function validateHandoff(value, { timestamp, validateTime }) {
  if (!isRecord(value) || !hasExactHandoffKeys(value)) return null;
  if (value.kind !== HANDOFF_KIND || value.version !== HANDOFF_VERSION) return null;
  if (!isCanonicalIsoTimestamp(value.createdAt)) return null;
  if (!plannerCities.has(value.city) || !plannerStyles.has(value.style)) return null;
  if (!Number.isInteger(value.guestCount) || value.guestCount < 20 || value.guestCount > 5000) return null;
  if (!isExactUniqueList(value.ceremonies, plannerCeremonies, { min: 1 })) return null;
  if (!isExactUniqueList(value.priorities, plannerPriorities)) return null;
  if (typeof value.constraints !== "string" || value.constraints !== value.constraints.trim() || value.constraints.length > MAX_CONSTRAINTS_LENGTH) return null;
  if (!isCanonicalIsoDate(value.eventDate)) return null;

  if (validateTime) {
    if (!Number.isFinite(timestamp) || !isFutureIsoDate(value.eventDate, timestamp)) return null;
    const createdTimestamp = Date.parse(value.createdAt);
    if (createdTimestamp - timestamp > HANDOFF_FUTURE_SKEW_MS) return null;
    if (timestamp - createdTimestamp >= HANDOFF_TTL_MS) return null;
  }

  return {
    kind: HANDOFF_KIND,
    version: HANDOFF_VERSION,
    createdAt: value.createdAt,
    eventDate: value.eventDate,
    city: value.city,
    guestCount: value.guestCount,
    style: value.style,
    ceremonies: [...value.ceremonies],
    priorities: [...value.priorities],
    constraints: value.constraints,
  };
}

export function createPlannerRequestHandoff(form, { now } = {}) {
  try {
    const timestamp = nowTimestamp(now);
    if (!Number.isFinite(timestamp) || !isRecord(form)) return null;
    const guestCount = normalizeGuestCount(form.guestCount);
    const constraints = typeof form.constraints === "string" ? form.constraints.trim() : null;
    if (!plannerCities.has(form.city) || !plannerStyles.has(form.style)) return null;
    if (!isFutureIsoDate(form.eventDate, timestamp) || guestCount === null) return null;
    if (!isExactUniqueList(form.ceremonies, plannerCeremonies, { min: 1 })) return null;
    if (!isExactUniqueList(form.priorities, plannerPriorities)) return null;
    if (constraints === null || constraints.length > MAX_CONSTRAINTS_LENGTH) return null;

    return {
      kind: HANDOFF_KIND,
      version: HANDOFF_VERSION,
      createdAt: new Date(timestamp).toISOString(),
      eventDate: form.eventDate,
      city: form.city,
      guestCount,
      style: form.style,
      ceremonies: [...form.ceremonies],
      priorities: [...form.priorities],
      constraints,
    };
  } catch {
    return null;
  }
}

export function readPlannerRequestHandoff(locationState, { now } = {}) {
  try {
    const timestamp = nowTimestamp(now);
    if (!Number.isFinite(timestamp) || !isRecord(locationState)) return null;
    return validateHandoff(locationState[PLANNER_HANDOFF_STATE_KEY], { timestamp, validateTime: true });
  } catch {
    return null;
  }
}

export function plannerHandoffToRequestPrefill(handoff) {
  try {
    const value = validateHandoff(handoff, { timestamp: Number.NaN, validateTime: false });
    if (!value) return null;

    const requirements = [
      `Events: ${value.ceremonies.length ? value.ceremonies.join(", ") : "Not specified"}.`,
      `Style: ${value.style}.`,
      `Priorities: ${value.priorities.length ? value.priorities.join(", ") : "Not specified"}.`,
      ...(value.constraints ? [`Planning considerations: ${value.constraints}`] : []),
    ].join("\n");

    if (requirements.length > MAX_REQUIREMENTS_LENGTH) return null;
    return {
      eventType: "",
      eventDate: value.eventDate,
      city: value.city,
      guestCount: String(value.guestCount),
      requirements,
    };
  } catch {
    return null;
  }
}
