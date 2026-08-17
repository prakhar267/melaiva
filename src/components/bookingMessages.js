export const BOOKING_MESSAGE_POLL_INTERVAL_MS = 30_000;
export const BOOKING_MESSAGE_MAX_POLL_DELAY_MS = 5 * 60_000;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function optionalUnreadMessageCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function totalUnreadMessageCount(threads = []) {
  return threads.reduce((total, thread) => (
    total + (optionalUnreadMessageCount(thread?.unreadMessageCount) || 0)
  ), 0);
}

export function clearBookingUnreadState(threads = []) {
  return threads.map((thread) => {
    if (!thread || typeof thread !== "object") return thread;
    const next = { ...thread };
    delete next.unreadMessageCount;
    delete next.readThroughSequence;
    return next;
  });
}

export function nextBookingThreadHydrationAttempt({
  missingIds = [],
  summaryGeneration = 0,
  previous = null,
} = {}) {
  const ids = [...new Set(missingIds.filter((id) => typeof id === "string" && id.length > 0))].sort();
  if (!ids.length) return { shouldHydrate: false, attempt: null };
  const generation = Number.isSafeInteger(summaryGeneration) && summaryGeneration >= 0
    ? summaryGeneration
    : 0;
  const attempt = { signature: JSON.stringify(ids), summaryGeneration: generation };
  return {
    shouldHydrate: previous?.signature !== attempt.signature
      || previous?.summaryGeneration !== attempt.summaryGeneration,
    attempt,
  };
}

export function formatUnreadMessageCount(value, maximum = 99) {
  const count = optionalUnreadMessageCount(value) || 0;
  const cap = Number.isSafeInteger(maximum) && maximum > 0 ? maximum : 99;
  return count > cap ? `${cap}+` : String(count);
}

export function mergeBookingThreadMetadata(current = {}, incoming = {}) {
  const currentMessageCount = finiteNumber(current?.messageCount);
  const incomingMessageCount = finiteNumber(incoming?.messageCount);
  const currentReadSequence = finiteNumber(current?.readThroughSequence);
  const incomingReadSequence = finiteNumber(incoming?.readThroughSequence);
  if (
    currentMessageCount !== null
    && incomingMessageCount !== null
    && incomingMessageCount < currentMessageCount
  ) return current;
  if (
    currentMessageCount !== null
    && incomingMessageCount === currentMessageCount
    && currentReadSequence !== null
    && incomingReadSequence !== null
    && incomingReadSequence < currentReadSequence
  ) return current;

  const merged = { ...current, ...incoming };
  const currentUnread = optionalUnreadMessageCount(current?.unreadMessageCount);
  const incomingUnread = optionalUnreadMessageCount(incoming?.unreadMessageCount);

  if (incomingUnread === null || (currentMessageCount !== null && incomingMessageCount === null)) {
    if (currentUnread === null) delete merged.unreadMessageCount;
    else merged.unreadMessageCount = currentUnread;
  } else if (
    currentUnread !== null
    && currentMessageCount !== null
    && incomingMessageCount !== null
    && incomingMessageCount === currentMessageCount
  ) {
    merged.unreadMessageCount = Math.min(currentUnread, incomingUnread);
  } else {
    merged.unreadMessageCount = incomingUnread;
  }

  if (currentMessageCount !== null && incomingMessageCount === null) {
    merged.messageCount = currentMessageCount;
  }
  if (currentReadSequence !== null && incomingReadSequence === null) {
    merged.readThroughSequence = currentReadSequence;
  }
  return merged;
}

export function mergeBookingThreads(current = [], incoming = []) {
  const currentById = new Map(current.filter((thread) => thread?.id).map((thread) => [thread.id, thread]));
  const mergedById = new Map();
  for (const thread of incoming) {
    if (!thread?.id) continue;
    const base = mergedById.get(thread.id) || currentById.get(thread.id);
    mergedById.set(thread.id, mergeBookingThreadMetadata(base, thread));
  }
  return [...mergedById.values()];
}

function compareMessages(first, second) {
  const firstSequence = finiteNumber(first?.sequence);
  const secondSequence = finiteNumber(second?.sequence);
  if (firstSequence !== null && secondSequence !== null && firstSequence !== secondSequence) {
    return firstSequence - secondSequence;
  }

  const firstTime = Date.parse(first?.createdAt || "");
  const secondTime = Date.parse(second?.createdAt || "");
  if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
    return firstTime - secondTime;
  }

  return String(first?.id || "").localeCompare(String(second?.id || ""));
}

export function mergeBookingMessages(current = [], incoming = []) {
  const byId = new Map();
  for (const message of [...current, ...incoming]) {
    if (!message?.id) continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareMessages);
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const retryAt = Date.parse(String(value));
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

export function bookingMessagePollDelay({
  consecutiveFailures = 0,
  retryAfter = null,
  nowMs = Date.now(),
  randomValue = Math.random(),
  baseMs = BOOKING_MESSAGE_POLL_INTERVAL_MS,
  maxMs = BOOKING_MESSAGE_MAX_POLL_DELAY_MS,
} = {}) {
  const retryAfterMs = parseRetryAfterMs(retryAfter, nowMs);
  if (retryAfterMs !== null) return Math.min(maxMs, Math.max(1_000, retryAfterMs));
  if (consecutiveFailures <= 0) return baseMs;

  const backoff = Math.min(maxMs, baseMs * (2 ** Math.min(consecutiveFailures, 8)));
  const boundedRandom = Math.min(1, Math.max(0, Number(randomValue) || 0));
  const jitter = Math.floor(backoff * 0.2 * boundedRandom);
  return Math.min(maxMs, backoff + jitter);
}

export function shouldStickToLatest({ scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}, threshold = 120) {
  const distance = Number(scrollHeight) - Number(clientHeight) - Number(scrollTop);
  return distance <= Math.max(0, threshold);
}

export function shouldScrollToLatest({ initial = false, addedCount = 0, nearLatest = false } = {}) {
  return Boolean(initial || (Number(addedCount) > 0 && nearLatest));
}

export function shouldAcknowledgeRenderedMessages({
  hasUnreadState = false,
  unreadMessageCount = 0,
  messageId = null,
  latestMessageVisible = false,
  documentVisible = false,
  windowFocused = false,
  loading = false,
} = {}) {
  return Boolean(
    hasUnreadState
    && optionalUnreadMessageCount(unreadMessageCount) > 0
    && typeof messageId === "string"
    && messageId.length > 0
    && latestMessageVisible
    && documentVisible
    && windowFocused
    && !loading
  );
}

export function isBookingMessageEndVisible(entry, minimumRatio = 0.5) {
  const ratio = Number(entry?.intersectionRatio);
  const threshold = Number.isFinite(Number(minimumRatio))
    ? Math.min(1, Math.max(0, Number(minimumRatio)))
    : 0.5;
  return Boolean(entry?.isIntersecting && Number.isFinite(ratio) && ratio >= threshold);
}

export function nextBookingMessageAnnouncement(current = {}, message = "") {
  const sequence = Number.isSafeInteger(current?.sequence) && current.sequence >= 0
    ? current.sequence + 1
    : 1;
  return { sequence, message: String(message || "") };
}

export function targetScrollLeftForControl({
  scrollLeft = 0,
  clientWidth = 0,
  itemOffsetLeft = 0,
  itemOffsetWidth = 0,
  maxScrollLeft = Number.POSITIVE_INFINITY,
  padding = 12,
} = {}) {
  const current = Math.max(0, Number(scrollLeft) || 0);
  const width = Math.max(0, Number(clientWidth) || 0);
  const itemStart = Math.max(0, Number(itemOffsetLeft) || 0);
  const itemEnd = itemStart + Math.max(0, Number(itemOffsetWidth) || 0);
  const inset = Math.max(0, Number(padding) || 0);
  const visibleStart = current + inset;
  const visibleEnd = current + width - inset;
  let target = current;

  if (itemStart < visibleStart) target = itemStart - inset;
  else if (itemEnd > visibleEnd) target = itemEnd - width + inset;

  return Math.min(Math.max(0, Number(maxScrollLeft)), Math.max(0, target));
}
