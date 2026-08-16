import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  const [messagesRefreshKey, setMessagesRefreshKey] = useState(0);
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
  const appliedPreferredRef = useRef(null);
  selectedBookingIdRef.current = selectedBookingId;

  const draft = selectedBookingId ? drafts[selectedBookingId] || "" : "";
  const sendError = selectedBookingId ? sendErrors[selectedBookingId] || "" : "";
  const sending = selectedBookingId ? Boolean(sendPending[selectedBookingId]) : false;
  const sendNotice = selectedBookingId ? sendNotices[selectedBookingId] || "" : "";

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
      setMessages([]);
      setMessagesError("");
      setMessagesLoading(false);
      setPermissions({ canSend: false, pausedReason: null });
      setNextCursor(null);
      return undefined;
    }
    const bookingId = selectedBookingId;
    const controller = new AbortController();
    async function loadMessages() {
      setMessagesLoading(true);
      setMessagesError("");
      try {
        const response = await fetch(`/api/v1/bookings/${bookingId}/messages?limit=50`, {
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await readApiResponse(response, "This conversation could not be loaded.");
        if (controller.signal.aborted || selectedBookingIdRef.current !== bookingId) return;
        setMessages(Array.isArray(payload.data) ? payload.data : []);
        setPermissions(payload.meta?.permissions || { canSend: false, pausedReason: "Messaging is unavailable." });
        setNextCursor(payload.meta?.nextCursor || null);
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted || selectedBookingIdRef.current !== bookingId) return;
        setMessages([]);
        setMessagesError(error.message || "This conversation could not be loaded.");
        setPermissions({ canSend: false, pausedReason: null });
        setNextCursor(null);
      } finally {
        if (!controller.signal.aborted && selectedBookingIdRef.current === bookingId) setMessagesLoading(false);
      }
    }
    loadMessages();
    return () => controller.abort();
  }, [messagesRefreshKey, selectedBookingId]);

  useEffect(() => () => earlierRequestRef.current?.abort(), []);

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
      const response = await fetch(`/api/v1/bookings/${bookingId}/messages?limit=50&cursor=${encodeURIComponent(cursor)}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const payload = await readApiResponse(response, "Earlier messages could not be loaded.");
      if (controller.signal.aborted || selectedBookingIdRef.current !== bookingId) return;
      const older = Array.isArray(payload.data) ? payload.data : [];
      setMessages((current) => {
        const ids = new Set(current.map((message) => message.id));
        return [...older.filter((message) => !ids.has(message.id)), ...current];
      });
      setNextCursor(payload.meta?.nextCursor || null);
      setPermissions(payload.meta?.permissions || permissions);
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
    earlierRequestRef.current = null;
    setLoadingEarlier(false);
    setMessages([]);
    setMessagesError("");
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
        setMessages((current) => current.some((message) => message.id === sent.id) ? current : [...current, sent]);
      }
      if (sent?.id) {
        setThreads((current) => current.map((award) => award.id === bookingId
          ? { ...award, messageCount: Math.max(Number(award.messageCount || 0) + 1, 1) }
          : award));
      }
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
        <div><div className="eyebrow">Awarded work only</div><h2 id="booking-messages-title">Partner conversations</h2><p>Coordinate next steps without changing the frozen accepted scope.</p></div>
        <span><ShieldCheck size={15} /> Limited to award participants + support</span>
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

          <div className="booking-message-history" aria-label={`Messages with ${details.counterparty}`}>
            {messagesLoading ? (
              <MessagesState icon={LoaderCircle} title="Loading this conversation" message="Retrieving the chronological message history." />
            ) : messagesError && !messages.length ? (
              <MessagesState icon={CircleAlert} title="Conversation could not be loaded" message={messagesError} actionLabel="Retry" onAction={() => setMessagesRefreshKey((value) => value + 1)} error />
            ) : (
              <>
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
