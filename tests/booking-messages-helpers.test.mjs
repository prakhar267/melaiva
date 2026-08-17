import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_MESSAGE_MAX_POLL_DELAY_MS,
  BOOKING_MESSAGE_POLL_INTERVAL_MS,
  bookingMessagePollDelay,
  clearBookingUnreadState,
  formatUnreadMessageCount,
  isBookingMessageEndVisible,
  mergeBookingThreadMetadata,
  mergeBookingThreads,
  mergeBookingMessages,
  nextBookingThreadHydrationAttempt,
  nextBookingMessageAnnouncement,
  optionalUnreadMessageCount,
  parseRetryAfterMs,
  shouldAcknowledgeRenderedMessages,
  shouldScrollToLatest,
  shouldStickToLatest,
  targetScrollLeftForControl,
  totalUnreadMessageCount,
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

test("unread metadata is optional, exact and visually bounded", () => {
  assert.equal(optionalUnreadMessageCount(undefined), null);
  assert.equal(optionalUnreadMessageCount(""), null);
  assert.equal(optionalUnreadMessageCount(-1), null);
  assert.equal(optionalUnreadMessageCount(1.5), null);
  assert.equal(optionalUnreadMessageCount("4"), 4);
  assert.equal(formatUnreadMessageCount(0), "0");
  assert.equal(formatUnreadMessageCount(99), "99");
  assert.equal(formatUnreadMessageCount(100), "99+");
  assert.equal(totalUnreadMessageCount([
    { unreadMessageCount: 3 },
    { unreadMessageCount: "2" },
    { unreadMessageCount: undefined },
    { unreadMessageCount: -4 },
  ]), 5);
});

test("capability downgrade clears private unread state while retaining readable threads", () => {
  const downgraded = clearBookingUnreadState([
    {
      id: "booking-1",
      messageCount: 5,
      unreadMessageCount: 3,
      readThroughSequence: 2,
      snapshot: { request: { title: "Sangeet photography" } },
    },
  ]);
  assert.equal(totalUnreadMessageCount(downgraded), 0);
  assert.deepEqual(downgraded, [{
    id: "booking-1",
    messageCount: 5,
    snapshot: { request: { title: "Sangeet photography" } },
  }]);
});

test("thread metadata preserves v7 unread state across v6 omissions and stale heads", () => {
  const current = { id: "booking-1", messageCount: 5, unreadMessageCount: 2, title: "Current" };
  assert.deepEqual(
    mergeBookingThreadMetadata(current, { id: "booking-1", messageCount: 5, title: "Legacy response" }),
    { id: "booking-1", messageCount: 5, unreadMessageCount: 2, title: "Legacy response" },
  );
  assert.deepEqual(
    mergeBookingThreadMetadata(current, { id: "booking-1", messageCount: 5, unreadMessageCount: 0 }),
    { id: "booking-1", messageCount: 5, unreadMessageCount: 0, title: "Current" },
  );
  assert.deepEqual(
    mergeBookingThreadMetadata(current, { id: "booking-1", messageCount: 4, unreadMessageCount: 0 }),
    current,
  );
  assert.deepEqual(
    mergeBookingThreadMetadata(current, { id: "booking-1", messageCount: 6, unreadMessageCount: 3 }),
    { id: "booking-1", messageCount: 6, unreadMessageCount: 3, title: "Current" },
  );
  assert.deepEqual(
    mergeBookingThreadMetadata(current, { id: "booking-1", unreadMessageCount: 0 }),
    current,
  );
});

test("a delayed read acknowledgement cannot clear unread from a newer message head", () => {
  const current = {
    id: "booking-1",
    messageCount: 6,
    unreadMessageCount: 1,
    readThroughSequence: 4,
  };
  assert.deepEqual(
    mergeBookingThreadMetadata(current, {
      id: "booking-1",
      messageCount: 5,
      unreadMessageCount: 0,
      readThroughSequence: 5,
    }),
    current,
  );
  assert.deepEqual(
    mergeBookingThreadMetadata(current, {
      id: "booking-1",
      messageCount: 6,
      unreadMessageCount: 0,
      readThroughSequence: 3,
    }),
    current,
  );
});

test("thread refresh keeps server ordering, removes inaccessible threads and merges unread safely", () => {
  const merged = mergeBookingThreads(
    [
      { id: "booking-1", messageCount: 4, unreadMessageCount: 1 },
      { id: "booking-removed", messageCount: 2, unreadMessageCount: 2 },
    ],
    [
      { id: "booking-2", messageCount: 1, unreadMessageCount: 1 },
      { id: "booking-1", messageCount: 4 },
    ],
  );
  assert.deepEqual(merged.map((thread) => thread.id), ["booking-2", "booking-1"]);
  assert.equal(merged[1].unreadMessageCount, 1);
});

test("thread refresh de-duplicates page overlap without regressing its newest head", () => {
  const merged = mergeBookingThreads(
    [{ id: "booking-1", messageCount: 3, unreadMessageCount: 1 }],
    [
      { id: "booking-1", messageCount: 4, unreadMessageCount: 2 },
      { id: "booking-1", messageCount: 3, unreadMessageCount: 0 },
    ],
  );
  assert.deepEqual(merged, [{ id: "booking-1", messageCount: 4, unreadMessageCount: 2 }]);
});

test("unknown-thread hydration retries at most once per successful summary generation", () => {
  const first = nextBookingThreadHydrationAttempt({
    missingIds: ["booking-2", "booking-1", "booking-2"],
    summaryGeneration: 7,
  });
  assert.equal(first.shouldHydrate, true);
  assert.deepEqual(first.attempt, {
    signature: JSON.stringify(["booking-1", "booking-2"]),
    summaryGeneration: 7,
  });

  const sustainedFailureRender = nextBookingThreadHydrationAttempt({
    missingIds: ["booking-1", "booking-2"],
    summaryGeneration: 7,
    previous: first.attempt,
  });
  assert.equal(sustainedFailureRender.shouldHydrate, false);

  const nextSummary = nextBookingThreadHydrationAttempt({
    missingIds: ["booking-1", "booking-2"],
    summaryGeneration: 8,
    previous: first.attempt,
  });
  assert.equal(nextSummary.shouldHydrate, true);
  assert.equal(nextBookingThreadHydrationAttempt({ missingIds: [], summaryGeneration: 8 }).shouldHydrate, false);
});

test("read acknowledgement requires supported unread state and a foreground rendered latest message", () => {
  const ready = {
    hasUnreadState: true,
    unreadMessageCount: 2,
    messageId: "message-9",
    latestMessageVisible: true,
    documentVisible: true,
    windowFocused: true,
    loading: false,
  };
  assert.equal(shouldAcknowledgeRenderedMessages(ready), true);
  for (const override of [
    { hasUnreadState: false },
    { unreadMessageCount: 0 },
    { messageId: null },
    { latestMessageVisible: false },
    { documentVisible: false },
    { windowFocused: false },
    { loading: true },
  ]) {
    assert.equal(shouldAcknowledgeRenderedMessages({ ...ready, ...override }), false);
  }
});

test("history-end visibility tolerates subpixel max-scroll clipping without accepting edge contact", () => {
  assert.equal(isBookingMessageEndVisible({ isIntersecting: false, intersectionRatio: 1 }), false);
  assert.equal(isBookingMessageEndVisible({ isIntersecting: true, intersectionRatio: 0 }), false);
  assert.equal(isBookingMessageEndVisible({ isIntersecting: true, intersectionRatio: 0.49 }), false);
  assert.equal(isBookingMessageEndVisible({ isIntersecting: true, intersectionRatio: 0.5 }), true);
  assert.equal(isBookingMessageEndVisible({ isIntersecting: true, intersectionRatio: 0.75 }), true);
  assert.equal(isBookingMessageEndVisible({ isIntersecting: true, intersectionRatio: 1 }), true);
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
