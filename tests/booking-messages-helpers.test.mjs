import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_MESSAGE_MAX_POLL_DELAY_MS,
  BOOKING_MESSAGE_POLL_INTERVAL_MS,
  bookingMessagePollDelay,
  mergeBookingMessages,
  nextBookingMessageAnnouncement,
  parseRetryAfterMs,
  shouldScrollToLatest,
  shouldStickToLatest,
  targetScrollLeftForControl,
} from "../src/components/bookingMessages.js";

test("message pages merge by id and remain ordered by server sequence", () => {
  const current = [
    { id: "message-2", sequence: 2, body: "old copy" },
    { id: "message-1", sequence: 1, body: "first" },
  ];
  const incoming = [
    { id: "message-2", sequence: 2, body: "authoritative copy" },
    { id: "message-4", sequence: 4, body: "fourth" },
    { id: "message-3", sequence: 3, body: "third" },
  ];

  const merged = mergeBookingMessages(current, incoming);
  assert.deepEqual(merged.map((message) => message.id), ["message-1", "message-2", "message-3", "message-4"]);
  assert.equal(merged[1].body, "authoritative copy");
});

test("legacy messages without sequence retain deterministic chronological order", () => {
  const merged = mergeBookingMessages(
    [{ id: "later", createdAt: "2027-10-03T10:02:00.000Z" }],
    [{ id: "earlier", createdAt: "2027-10-03T10:01:00.000Z" }],
  );
  assert.deepEqual(merged.map((message) => message.id), ["earlier", "later"]);
});

test("poll delay uses a steady cadence, bounded exponential backoff and Retry-After", () => {
  assert.equal(bookingMessagePollDelay(), BOOKING_MESSAGE_POLL_INTERVAL_MS);
  assert.equal(bookingMessagePollDelay({ consecutiveFailures: 1, randomValue: 0 }), 60_000);
  assert.equal(bookingMessagePollDelay({ consecutiveFailures: 1, randomValue: 1 }), 72_000);
  assert.equal(
    bookingMessagePollDelay({ consecutiveFailures: 99, randomValue: 1 }),
    BOOKING_MESSAGE_MAX_POLL_DELAY_MS,
  );
  assert.equal(bookingMessagePollDelay({ retryAfter: "45" }), 45_000);
  assert.equal(
    bookingMessagePollDelay({ retryAfter: "9999" }),
    BOOKING_MESSAGE_MAX_POLL_DELAY_MS,
  );
});

test("Retry-After accepts HTTP dates and rejects malformed values", () => {
  const now = Date.parse("2027-10-03T10:00:00.000Z");
  assert.equal(parseRetryAfterMs("Sun, 03 Oct 2027 10:00:30 GMT", now), 30_000);
  assert.equal(parseRetryAfterMs("not-a-delay", now), null);
  assert.equal(parseRetryAfterMs(null, now), null);
});

test("latest-message anchoring only follows users already near the bottom", () => {
  assert.equal(shouldStickToLatest({ scrollTop: 780, scrollHeight: 1_000, clientHeight: 200 }), true);
  assert.equal(shouldStickToLatest({ scrollTop: 300, scrollHeight: 1_000, clientHeight: 200 }), false);
  assert.equal(shouldStickToLatest({ scrollTop: 680, scrollHeight: 1_000, clientHeight: 200 }, 120), true);
});

test("latest-message scrolling requires an initial load or newly merged records", () => {
  assert.equal(shouldScrollToLatest({ initial: true, addedCount: 0, nearLatest: false }), true);
  assert.equal(shouldScrollToLatest({ addedCount: 0, nearLatest: true }), false);
  assert.equal(shouldScrollToLatest({ addedCount: 1, nearLatest: true }), true);
  assert.equal(shouldScrollToLatest({ addedCount: 1, nearLatest: false }), false);
});

test("repeated announcement copy still receives a distinct mutation sequence", () => {
  const first = nextBookingMessageAnnouncement({}, "Conversation is up to date.");
  const second = nextBookingMessageAnnouncement(first, "Conversation is up to date.");
  assert.deepEqual(first, { sequence: 1, message: "Conversation is up to date." });
  assert.deepEqual(second, { sequence: 2, message: "Conversation is up to date." });
});

test("active workspace controls are revealed horizontally without moving when already visible", () => {
  assert.equal(targetScrollLeftForControl({
    scrollLeft: 0,
    clientWidth: 360,
    itemOffsetLeft: 110,
    itemOffsetWidth: 100,
    maxScrollLeft: 120,
  }), 0);
  assert.equal(targetScrollLeftForControl({
    scrollLeft: 0,
    clientWidth: 360,
    itemOffsetLeft: 330,
    itemOffsetWidth: 135,
    maxScrollLeft: 120,
  }), 117);
  assert.equal(targetScrollLeftForControl({
    scrollLeft: 117,
    clientWidth: 360,
    itemOffsetLeft: 0,
    itemOffsetWidth: 95,
    maxScrollLeft: 120,
  }), 0);
});
