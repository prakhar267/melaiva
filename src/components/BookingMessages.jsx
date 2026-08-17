import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CircleAlert,
  IndianRupee,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ScrollText,
  Send,
  ShieldCheck,
} from "lucide-react";
import { createIdempotencyKey, readApiResponse } from "../api.js";
import { formatCurrency } from "../data.js";
import {
  BOOKING_MESSAGE_POLL_INTERVAL_MS,
  bookingMessagePollDelay,
  mergeBookingMessages,
  nextBookingMessageAnnouncement,
  shouldScrollToLatest,
  shouldStickToLatest,
} from "./bookingMessages.js";

function formatDate(value) {
  if (!value) return "Date to be confirmed";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Date to be confirmed";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function categoryLabel(value) {
  const labels = {
    venues: "Venues",
    photography: "Photography",
    decor: "Decor & florals",
    catering: "Catering",
    beauty: "Beauty",
    music: "Music & entertainment",
  };
  return labels[value] || value?.replaceAll("_", " ") || "Celebration service";
}

function threadDetails(award, audience) {
  const snapshot = award?.snapshot || {};
  const request = snapshot.request || {};
  const offer = snapshot.offer || {};
  const vendor = snapshot.vendor || {};
  return {
    request,
    offer,
    vendor,
    counterparty: audience === "vendor" ? "Celebration host" : vendor.businessName || "Selected partner",
    service: categoryLabel(request.categories?.[0]),
  };
}

function MessagesState({ icon: Icon = MessageSquareText, title, message, actionLabel, onAction, error = false }) {
  return (
    <div className="booking-messages__state" role={error ? "alert" : "status"}>
      <span><Icon className={Icon === LoaderCircle ? "spin-icon" : ""} size={27} /></span>
      <h3>{title}</h3>
      <p>{message}</p>
      {actionLabel && <button className="button button--small button--outline" type="button" onClick={onAction}><RefreshCw size={14} /> {actionLabel}</button>}
    </div>
  );
}

export function BookingMessages({
  audience,
  preferredBookingId = null,
  focusRequest = null,
  onFocusRequestHandled,
  onViewScope,
  emptyActionLabel,
  onEmptyAction,
}) {
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState("");
  const [threadsRefreshKey, setThreadsRefreshKey] = useState(0);
  const [selectedBookingId, setSelectedBookingId] = useState(preferredBookingId);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [messagesRefreshing, setMessagesRefreshing] = useState(false);
  const [refreshAnnouncement, setRefreshAnnouncement] = useState({ sequence: 0, message: "" });
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [pollRestartKey, setPollRestartKey] = useState(0);
  const [permissions, setPermissions] = useState({ canSend: false, pausedReason: null });
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [sendErrors, setSendErrors] = useState({});
  const [sendPending, setSendPending] = useState({});
  const [sendNotices, setSendNotices] = useState({});
  const sendAttemptsRef = useRef(new Map());
  const selectedBookingIdRef = useRef(selectedBookingId);
  const earlierRequestRef = useRef(null);
  const latestRequestRef = useRef(null);
  const messagesRef = useRef(messages);
  const pollCursorRef = useRef(null);
  const pollingStoppedRef = useRef(false);
  const historyRef = useRef(null);
  const scrollModeRef = useRef(null);
  const headingRef = useRef(null);
  const composerRef = useRef(null);
  const appliedFocusRequestRef = useRef(null);
  const appliedPreferredRef = useRef(null);
  selectedBookingIdRef.current = selectedBookingId;
  messagesRef.current = messages;

  const draft = selectedBookingId ? drafts[selectedBookingId] || "" : "";
  const sendError = selectedBookingId ? sendErrors[selectedBookingId] || "" : "";
  const sending = selectedBookingId ? Boolean(sendPending[selectedBookingId]) : false;
  const sendNotice = selectedBookingId ? sendNotices[selectedBookingId] || "" : "";

  function announceRefresh(message) {
    setRefreshAnnouncement((current) => nextBookingMessageAnnouncement(current, message));
  }

  function resetRefreshAnnouncement() {
    setRefreshAnnouncement((current) => nextBookingMessageAnnouncement(current, ""));
  }

  function updateThreadMessageCount(bookingId, value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return;
    setThreads((current) => current.map((award) => award.id === bookingId
      ? { ...award, messageCount: Math.max(Number(award.messageCount || 0), count) }
      : award));
  }

  async function fetchMessagePage(bookingId, { after = null, cursor = null, signal } = {}) {
    const search = new URLSearchParams({ limit: "50" });
    if (after !== null && after !== undefined && after !== "") search.set("after", String(after));
    if (cursor !== null && cursor !== undefined && cursor !== "") search.set("cursor", String(cursor));
    const response = await fetch(`/api/v1/bookings/${bookingId}/messages?${search}`, {
      credentials: "include",
      signal,
    });
    const retryAfter = response.headers.get("Retry-After");
    try {
      return {
        payload: await readApiResponse(response, "This conversation could not be loaded."),
        retryAfter,
      };
    } catch (error) {
      error.retryAfter = retryAfter;
      throw error;
    }
  }

  function refreshLatest(bookingId, { initial = false, announce = true } = {}) {
    const activeRequest = latestRequestRef.current;
    if (activeRequest?.bookingId === bookingId) return activeRequest.promise;
    activeRequest?.controller.abort();

    const controller = new AbortController();
    const request = { bookingId, controller, promise: null };
    request.promise = (async () => {
      let after = initial ? null : pollCursorRef.current;
      const incremental = after !== null && after !== undefined && after !== "";
      const knownIds = new Set(messagesRef.current.map((message) => message.id));
      const incoming = [];
      let finalMeta = {};
      let initialNextCursor = null;
      let retryAfter = null;

      do {
        const page = await fetchMessagePage(bookingId, { after, signal: controller.signal });
        retryAfter = page.retryAfter;
        const payload = page.payload || {};
        const pageMessages = Array.isArray(payload.data) ? payload.data : [];
        incoming.push(...pageMessages);
        finalMeta = payload.meta || {};
        if (!incremental) initialNextCursor = finalMeta.nextCursor || null;

        if (!incremental || !finalMeta.hasMore) break;
        const nextPollCursor = finalMeta.pollCursor;
        if (nextPollCursor === null || nextPollCursor === undefined || String(nextPollCursor) === String(after)) {
          const cursorError = new Error("Conversation refresh did not advance. Please try again.");
          cursorError.code = "poll_cursor_stalled";
          throw cursorError;
        }
        after = nextPollCursor;
      } while (true);

      if (controller.signal.aborted || selectedBookingIdRef.current !== bookingId) {
        return { ok: false, cancelled: true };
      }

      const history = historyRef.current;
      const nearLatest = shouldStickToLatest(history || {});
      const addedMessages = incoming.filter((message) => message?.id && !knownIds.has(message.id));
      const newlyAdded = addedMessages.filter((message) => !message.mine);
      const shouldFollow = shouldScrollToLatest({
        initial,
        addedCount: addedMessages.length,
        nearLatest,
      });
      const merged = mergeBookingMessages(messagesRef.current, incoming);
      messagesRef.current = merged;
      if (shouldFollow) scrollModeRef.current = { type: "latest" };
      setMessages(merged);
      if (!incremental) setNextCursor(initialNextCursor);
      if (finalMeta.pollCursor !== undefined && finalMeta.pollCursor !== null) {
        pollCursorRef.current = finalMeta.pollCursor;
      }
      updateThreadMessageCount(bookingId, finalMeta.messageCount);
      setPermissions(finalMeta.permissions || { canSend: false, pausedReason: "Messaging is unavailable." });
      setMessagesError("");
      pollingStoppedRef.current = false;

      const announced = Boolean(!initial && newlyAdded.length && announce);
      if (!initial && newlyAdded.length) {
        const count = newlyAdded.length;
        if (announced) announceRefresh(`${count} new message${count === 1 ? "" : "s"} added to this conversation.`);
        if (shouldFollow) setNewMessageCount(0);
        else setNewMessageCount((current) => current + count);
      }

      return { ok: true, added: newlyAdded.length, announced, retryAfter };
    })().catch((error) => {
      if (error?.name === "AbortError" || controller.signal.aborted || selectedBookingIdRef.current !== bookingId) {
        return { ok: false, cancelled: true };
      }
      const terminal = [401, 404].includes(Number(error?.status));
      if (terminal) {
        pollingStoppedRef.current = true;
        setPermissions({ canSend: false, pausedReason: error.message || "Messaging is no longer available." });
        setMessagesError(error.message || "Live message updates have stopped.");
        announceRefresh("Live message updates have stopped.");
      }
      return {
        ok: false,
        terminal,
        retryAfter: error?.retryAfter || null,
        message: error?.message || "Updates could not be checked. Your conversation is still here.",
      };
    }).finally(() => {
      if (latestRequestRef.current === request) latestRequestRef.current = null;
    });
    latestRequestRef.current = request;
    return request.promise;
  }

  async function checkForUpdates() {
    const bookingId = selectedBookingIdRef.current;
    if (!bookingId || messagesRefreshing) return;
    setMessagesRefreshing(true);
    setMessagesError("");
    const result = await refreshLatest(bookingId, { announce: false });
    if (!result.ok && !result.cancelled && !result.terminal) setMessagesError(result.message);
    if (result.ok) {
      if (!result.announced) {
        announceRefresh(result.added ? `${result.added} new message${result.added === 1 ? "" : "s"} added to this conversation.` : "Conversation is up to date.");
      }
      setPollRestartKey((value) => value + 1);
    }
    setMessagesRefreshing(false);
  }

  function jumpToLatest() {
    const history = historyRef.current;
    if (!history) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    history.scrollTo({ top: history.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    history.focus({ preventScroll: true });
    setNewMessageCount(0);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function loadThreads() {
      setThreadsLoading(true);
      setThreadsError("");
      try {
        const response = await fetch("/api/v1/bookings?limit=50", { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Awarded conversations could not be loaded.");
        const nextThreads = (Array.isArray(payload.data) ? payload.data : [])
          .filter((award) => award.audienceRole === audience || award.audienceRole === "admin");
        if (controller.signal.aborted) return;
        setThreads(nextThreads);
        const current = selectedBookingIdRef.current;
        const nextSelection = preferredBookingId && nextThreads.some((award) => award.id === preferredBookingId)
          ? preferredBookingId
          : nextThreads.some((award) => award.id === current) ? current : nextThreads[0]?.id || null;
        if (nextSelection !== current) selectBooking(nextSelection);
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setThreads([]);
        setThreadsError(error.message || "Awarded conversations could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setThreadsLoading(false);
      }
    }
    loadThreads();
    return () => controller.abort();
  }, [audience, preferredBookingId, threadsRefreshKey]);

  useEffect(() => {
    if (
      preferredBookingId
      && appliedPreferredRef.current !== preferredBookingId
      && threads.some((award) => award.id === preferredBookingId)
    ) {
      selectBooking(preferredBookingId);
      appliedPreferredRef.current = preferredBookingId;
    }
  }, [preferredBookingId, threads]);

  const selectedThread = useMemo(
    () => threads.find((award) => award.id === selectedBookingId) || null,
    [selectedBookingId, threads],
  );
  const details = useMemo(() => threadDetails(selectedThread, audience), [audience, selectedThread]);

  useEffect(() => {
    if (!selectedBookingId) {
      latestRequestRef.current?.controller.abort();
      latestRequestRef.current = null;
      messagesRef.current = [];
      pollCursorRef.current = null;
      pollingStoppedRef.current = false;
      setMessages([]);
      setMessagesError("");
      setMessagesLoading(false);
      setMessagesRefreshing(false);
      resetRefreshAnnouncement();
      setNewMessageCount(0);
      setPermissions({ canSend: false, pausedReason: null });
      setNextCursor(null);
      return undefined;
    }
    const bookingId = selectedBookingId;
    pollCursorRef.current = null;
    pollingStoppedRef.current = false;
    setMessagesError("");
    resetRefreshAnnouncement();
    setNewMessageCount(0);
    setMessagesLoading(true);
    async function loadMessages() {
      const result = await refreshLatest(bookingId, { initial: true });
      if (result.cancelled || selectedBookingIdRef.current !== bookingId) return;
      if (!result.ok && !result.terminal) {
        messagesRef.current = [];
        setMessages([]);
        setMessagesError(result.message || "This conversation could not be loaded.");
        setPermissions({ canSend: false, pausedReason: null });
        setNextCursor(null);
      }
      setMessagesLoading(false);
    }
    loadMessages();
    return () => {
      const request = latestRequestRef.current;
      if (request?.bookingId === bookingId) {
        request.controller.abort();
        latestRequestRef.current = null;
      }
    };
  }, [selectedBookingId]);

  useEffect(() => {
    const bookingId = selectedBookingId;
    if (!bookingId || messagesLoading) return undefined;
    let disposed = false;
    let timer = null;
    let running = false;
    let consecutiveFailures = 0;

    function schedule(delay = BOOKING_MESSAGE_POLL_INTERVAL_MS) {
      window.clearTimeout(timer);
      if (!disposed && !pollingStoppedRef.current) timer = window.setTimeout(run, delay);
    }

    async function run() {
      if (disposed || running || pollingStoppedRef.current) return;
      if (document.visibilityState !== "visible" || navigator.onLine === false) {
        schedule();
        return;
      }
      running = true;
      const result = await refreshLatest(bookingId);
      running = false;
      if (disposed || result.cancelled || result.terminal) return;
      consecutiveFailures = result.ok ? 0 : consecutiveFailures + 1;
      if (!result.ok && consecutiveFailures >= 3) {
        setMessagesError("Live updates are having trouble reconnecting. Your conversation is still here; use Check for updates to try now.");
      }
      schedule(bookingMessagePollDelay({
        consecutiveFailures,
        retryAfter: result.retryAfter,
      }));
    }

    function resume() {
      if (disposed || document.visibilityState !== "visible" || navigator.onLine === false) return;
      window.clearTimeout(timer);
      run();
    }

    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [messagesLoading, pollRestartKey, selectedBookingId]);

  useEffect(() => {
    const mode = scrollModeRef.current;
    const history = historyRef.current;
    if (!mode || !history || messagesLoading || threadsLoading) return undefined;
    scrollModeRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (mode.type === "latest") history.scrollTop = history.scrollHeight;
      if (mode.type === "preserve") {
        history.scrollTop = mode.scrollTop + Math.max(0, history.scrollHeight - mode.scrollHeight);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, messagesLoading, selectedBookingId, threadsLoading]);

  useEffect(() => {
    if (!focusRequest || appliedFocusRequestRef.current === focusRequest || messagesLoading || threadsLoading || !selectedBookingId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (appliedFocusRequestRef.current === focusRequest) return;
      const canFocusComposer = permissions.canSend && !composerRef.current?.disabled;
      const target = canFocusComposer ? composerRef.current : headingRef.current;
      if (!target) return;
      appliedFocusRequestRef.current = focusRequest;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: canFocusComposer ? "center" : "start", behavior: reducedMotion ? "auto" : "smooth" });
      onFocusRequestHandled?.(focusRequest);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, messagesLoading, onFocusRequestHandled, permissions.canSend, selectedBookingId, threadsLoading]);

  useEffect(() => () => {
    earlierRequestRef.current?.abort();
    latestRequestRef.current?.controller.abort();
    latestRequestRef.current = null;
  }, []);

  async function loadEarlier() {
    if (!selectedBookingId || !nextCursor || loadingEarlier) return;
    const bookingId = selectedBookingId;
    const cursor = nextCursor;
    earlierRequestRef.current?.abort();
    const controller = new AbortController();
    earlierRequestRef.current = controller;
    setLoadingEarlier(true);
    setMessagesError("");
    try {
      const { payload } = await fetchMessagePage(bookingId, { cursor, signal: controller.signal });
      if (controller.signal.aborted || selectedBookingIdRef.current !== bookingId) return;
      const older = Array.isArray(payload.data) ? payload.data : [];
      const history = historyRef.current;
      if (history) scrollModeRef.current = { type: "preserve", scrollHeight: history.scrollHeight, scrollTop: history.scrollTop };
      const merged = mergeBookingMessages(messagesRef.current, older);
      messagesRef.current = merged;
      setMessages(merged);
      setNextCursor(payload.meta?.nextCursor || null);
      updateThreadMessageCount(bookingId, payload.meta?.messageCount);
      setPermissions(payload.meta?.permissions || { canSend: false, pausedReason: "Messaging is unavailable." });
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted || selectedBookingIdRef.current !== bookingId) return;
      setMessagesError(error.message || "Earlier messages could not be loaded.");
    } finally {
      if (earlierRequestRef.current === controller) earlierRequestRef.current = null;
      if (selectedBookingIdRef.current === bookingId) setLoadingEarlier(false);
    }
  }

  function selectBooking(bookingId) {
    if (bookingId === selectedBookingIdRef.current) return;
    earlierRequestRef.current?.abort();
    latestRequestRef.current?.controller.abort();
    earlierRequestRef.current = null;
    latestRequestRef.current = null;
    messagesRef.current = [];
    pollCursorRef.current = null;
    pollingStoppedRef.current = false;
    setLoadingEarlier(false);
    setMessagesLoading(true);
    setMessages([]);
    setMessagesError("");
    setMessagesRefreshing(false);
    resetRefreshAnnouncement();
    setNewMessageCount(0);
    setNextCursor(null);
    setPermissions({ canSend: false, pausedReason: null });
    setSelectedBookingId(bookingId);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const bookingId = selectedBookingId;
    const body = draft.trim();
    if (!bookingId) return;
    setSendErrors((current) => ({ ...current, [bookingId]: "" }));
    setSendNotices((current) => ({ ...current, [bookingId]: "" }));
    if (body.length < 2) {
      setSendErrors((current) => ({ ...current, [bookingId]: "Write at least two characters before sending." }));
      return;
    }
    if (body.length > 2_000) {
      setSendErrors((current) => ({ ...current, [bookingId]: "Keep this message to 2,000 characters or fewer." }));
      return;
    }
    if (!permissions.canSend) return;
    const previousAttempt = sendAttemptsRef.current.get(bookingId);
    if (!previousAttempt || previousAttempt.body !== body) {
      sendAttemptsRef.current.set(bookingId, { body, key: createIdempotencyKey("booking-message") });
    }
    const attempt = sendAttemptsRef.current.get(bookingId);
    setSendPending((current) => ({ ...current, [bookingId]: true }));
    try {
      const response = await fetch(`/api/v1/bookings/${bookingId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        credentials: "include",
        body: JSON.stringify({ body }),
      });
      const payload = await readApiResponse(response, "Your message was not sent.");
      const sent = payload.data;
      if (sent?.id && selectedBookingIdRef.current === bookingId) {
        const merged = mergeBookingMessages(messagesRef.current, [sent]);
        messagesRef.current = merged;
        scrollModeRef.current = { type: "latest" };
        setMessages(merged);
      }
      if (sent?.id) updateThreadMessageCount(bookingId, payload.meta?.messageCount);
      setDrafts((current) => { const next = { ...current }; delete next[bookingId]; return next; });
      sendAttemptsRef.current.delete(bookingId);
      setSendNotices((current) => ({ ...current, [bookingId]: "Message sent." }));
    } catch (error) {
      setSendErrors((current) => ({ ...current, [bookingId]: error.message || "Your message was not sent. Your draft is still here; try again." }));
    } finally {
      setSendPending((current) => { const next = { ...current }; delete next[bookingId]; return next; });
    }
  }

  if (threadsLoading) {
    return <section className="booking-messages booking-messages--single"><MessagesState icon={LoaderCircle} title="Loading awarded conversations" message="Retrieving the partners connected to your accepted scopes." /></section>;
  }

  if (threadsError) {
    return <section className="booking-messages booking-messages--single"><MessagesState icon={CircleAlert} title="Conversations could not be loaded" message={threadsError} actionLabel="Retry" onAction={() => setThreadsRefreshKey((value) => value + 1)} error /></section>;
  }

  if (!threads.length) {
    return (
      <section className="booking-messages booking-messages--single">
        <MessagesState title="No awarded conversations yet" message={audience === "vendor" ? "A conversation appears after a couple awards your offer." : "A conversation appears after you award an offer to a partner."} />
        {emptyActionLabel && <button className="button button--primary booking-messages__empty-action" type="button" onClick={onEmptyAction}>{emptyActionLabel}</button>}
      </section>
    );
  }

  return (
    <section className="booking-messages" aria-labelledby="booking-messages-title">
      <header className="booking-messages__header">
        <div><div className="eyebrow">Awarded work only</div><h2 id="booking-messages-title" ref={headingRef} tabIndex="-1">Partner conversations</h2><p>Coordinate next steps without changing the frozen accepted scope.</p></div>
        <div className="booking-messages__header-actions">
          <span><ShieldCheck size={15} /> Limited to award participants + support</span>
          <button className="button button--small button--outline booking-messages__refresh" type="button" onClick={checkForUpdates} disabled={!selectedBookingId || messagesLoading} aria-disabled={messagesRefreshing || undefined} aria-busy={messagesRefreshing}>
            <RefreshCw className={messagesRefreshing ? "spin-icon" : ""} size={14} /> {messagesRefreshing ? "Checking…" : "Check for updates"}
          </button>
        </div>
        <span className="sr-only" role="status" aria-live="polite"><span key={refreshAnnouncement.sequence}>{refreshAnnouncement.message}</span></span>
      </header>
      <div className="booking-messages__layout">
        <aside className="booking-threads" aria-label="Awarded conversations">
          {threads.map((award) => {
            const thread = threadDetails(award, audience);
            const count = Number(award.messageCount || 0);
            return (
              <button type="button" className={award.id === selectedBookingId ? "is-active" : ""} aria-pressed={award.id === selectedBookingId} onClick={() => selectBooking(award.id)} key={award.id}>
                <span className="booking-thread__icon"><MessageSquareText size={17} /></span>
                <span className="booking-thread__copy"><strong>{thread.request.title || thread.service}</strong><small>{thread.counterparty} · {thread.service}</small><em>{count} message{count === 1 ? "" : "s"}</em></span>
                <span className="status-pill status-pill--direct"><span /> Contract pending</span>
              </button>
            );
          })}
        </aside>
        <div className="booking-conversation" aria-busy={messagesLoading}>
          <div className="booking-conversation__context">
            <div><span><ScrollText size={16} /></span><p><small>Accepted scope</small><strong>{details.request.title || details.service}</strong><em>{details.counterparty}</em></p></div>
            <dl>
              <div><dt><CalendarDays size={13} /> Event</dt><dd>{formatDate(details.request.eventDate)}</dd></div>
              <div><dt><IndianRupee size={13} /> Accepted</dt><dd>{formatCurrency(details.offer.amount)}</dd></div>
            </dl>
            <button className="button button--small button--outline" type="button" onClick={() => onViewScope?.(selectedThread)}>View frozen scope</button>
          </div>

          <div
            className="booking-message-history"
            aria-label={`Messages with ${details.counterparty}`}
            ref={historyRef}
            tabIndex="-1"
            onScroll={(event) => {
              if (newMessageCount && shouldStickToLatest(event.currentTarget)) setNewMessageCount(0);
            }}
          >
            {messagesLoading ? (
              <MessagesState icon={LoaderCircle} title="Loading this conversation" message="Retrieving the chronological message history." />
            ) : messagesError && !messages.length ? (
              <MessagesState icon={CircleAlert} title="Conversation could not be loaded" message={messagesError} actionLabel="Retry" onAction={checkForUpdates} error />
            ) : (
              <>
                {newMessageCount > 0 && <button className="booking-message-history__latest" type="button" onClick={jumpToLatest}><ArrowDown size={14} /> {newMessageCount} new message{newMessageCount === 1 ? "" : "s"} · Jump to latest</button>}
                {nextCursor && <button className="booking-message-history__older" type="button" disabled={loadingEarlier} onClick={loadEarlier}><ArrowUp size={14} /> {loadingEarlier ? "Loading…" : "Load earlier messages"}</button>}
                {messagesError && <p className="booking-message-history__error" role="alert">{messagesError}</p>}
                {!messages.length ? (
                  <div className="booking-message-history__empty" role="status"><span><MessageSquareText size={24} /></span><h3>Your conversation is ready</h3><p>Use it to coordinate scope and written-contract next steps with {details.counterparty}.</p></div>
                ) : messages.map((message) => (
                  <article className={`booking-message ${message.mine ? "is-mine" : ""}`} key={message.id}>
                    <header><strong>{message.mine ? "You" : message.senderLabel}</strong><time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time></header>
                    <p>{message.body}</p>
                  </article>
                ))}
              </>
            )}
          </div>

          <div className="booking-message-boundary"><CircleAlert size={15} /><p><strong>Contract pending.</strong> Messages are not a contract, signature, invoice or proof of payment. Arrange and review the written contract directly; Melaiva does not provide signatures or payments.</p></div>

          {permissions.pausedReason && <div className="booking-message-paused" role="status"><ShieldCheck size={16} /><p><strong>Sending is paused.</strong> {permissions.pausedReason}</p></div>}

          <form className="booking-message-composer" onSubmit={sendMessage}>
            <label htmlFor={`booking-message-${selectedBookingId}`}>Message {details.counterparty}</label>
            <textarea
              ref={composerRef}
              id={`booking-message-${selectedBookingId}`}
              rows="4"
              value={draft}
              onChange={(event) => {
                const value = event.target.value;
                setDrafts((current) => ({ ...current, [selectedBookingId]: value }));
                setSendErrors((current) => ({ ...current, [selectedBookingId]: "" }));
                setSendNotices((current) => ({ ...current, [selectedBookingId]: "" }));
              }}
              minLength="2"
              maxLength="2000"
              placeholder="Coordinate timing, scope questions or written-contract next steps…"
              disabled={!permissions.canSend || messagesLoading || sending}
              aria-describedby={`booking-message-help-${selectedBookingId}`}
            />
            <div className="booking-message-composer__footer">
              <p id={`booking-message-help-${selectedBookingId}`}>{draft.length.toLocaleString("en-IN")} / 2,000 · Plain text only</p>
              <button className="button button--primary" type="submit" disabled={!permissions.canSend || messagesLoading || sending || draft.trim().length < 2}>{sending ? <span className="button-loader" aria-hidden="true" /> : <Send size={15} />}{sending ? "Sending…" : "Send message"}</button>
            </div>
            {sendError && <p className="booking-message-composer__error" role="alert">{sendError}</p>}
            <span className="sr-only" role="status" aria-live="polite">{sendNotice}</span>
          </form>
        </div>
      </div>
    </section>
  );
}
