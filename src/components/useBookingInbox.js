import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readApiResponse } from "../api.js";
import {
  BOOKING_MESSAGE_POLL_INTERVAL_MS,
  bookingMessagePollDelay,
  clearBookingUnreadState,
  mergeBookingThreadMetadata,
  mergeBookingThreads,
  optionalUnreadMessageCount,
  totalUnreadMessageCount,
} from "./bookingMessages.js";

const BOOKING_SUMMARY_PAGE_LIMIT = 50;
const BOOKING_SUMMARY_MAX_PAGES = 100;

export function useBookingInbox({ audience, enabled }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const [unreadSupported, setUnreadSupported] = useState(null);
  const [summaryGeneration, setSummaryGeneration] = useState(0);
  const threadsRef = useRef(threads);
  const enabledRef = useRef(enabled);
  const unsupportedRef = useRef(false);
  const requestRef = useRef(null);
  threadsRef.current = threads;
  enabledRef.current = enabled;

  const refresh = useCallback(({ initial = false } = {}) => {
    if (!enabledRef.current) return Promise.resolve({ ok: false, cancelled: true });
    if (unsupportedRef.current) return Promise.resolve({ ok: false, unsupported: true });
    if (requestRef.current) return requestRef.current.promise;

    const controller = new AbortController();
    const request = { controller, promise: null };
    if (initial || !threadsRef.current.length) setLoading(true);
    setError("");
    request.promise = (async () => {
      const incoming = [];
      let page = 1;
      let retryAfter = null;
      while (page <= BOOKING_SUMMARY_MAX_PAGES) {
        const response = await fetch(`/api/v1/bookings/message-summary?page=${page}&limit=${BOOKING_SUMMARY_PAGE_LIMIT}`, {
          credentials: "include",
          signal: controller.signal,
        });
        retryAfter = response.headers.get("Retry-After");
        let payload;
        try {
          payload = await readApiResponse(response, "Awarded conversations could not be loaded.");
        } catch (requestError) {
          requestError.retryAfter = retryAfter;
          throw requestError;
        }
        if (!Array.isArray(payload?.data)) throw new Error("Awarded conversation summary was incomplete.");
        const reportedPage = Number(payload.meta?.page);
        if (!Number.isSafeInteger(reportedPage) || reportedPage !== page || typeof payload.meta?.hasMore !== "boolean") {
          throw new Error("Awarded conversation summary pagination was incomplete.");
        }
        incoming.push(...payload.data.filter((award) => (
          award.audienceRole === audience || award.audienceRole === "admin"
        )));
        if (!payload.meta.hasMore) break;
        if (page === BOOKING_SUMMARY_MAX_PAGES) {
          throw new Error("Awarded conversation summary exceeded the safe page limit.");
        }
        page += 1;
      }
      if (controller.signal.aborted || !enabledRef.current) return { ok: false, cancelled: true };
      const supportsUnread = incoming.length === 0
        ? null
        : incoming.every((thread) => optionalUnreadMessageCount(thread?.unreadMessageCount) !== null);
      setThreads((current) => {
        const merged = mergeBookingThreads(current, incoming);
        const next = supportsUnread === false ? clearBookingUnreadState(merged) : merged;
        threadsRef.current = next;
        return next;
      });
      if (supportsUnread !== null) setUnreadSupported(supportsUnread);
      if (supportsUnread === false) unsupportedRef.current = true;
      setSummaryGeneration((current) => current + 1);
      setError("");
      return { ok: true, retryAfter, unsupported: supportsUnread === false };
    })().catch((requestError) => {
      if (requestError?.name === "AbortError" || controller.signal.aborted || !enabledRef.current) {
        return { ok: false, cancelled: true };
      }
      if (Number(requestError?.status) === 404) {
        unsupportedRef.current = true;
        setUnreadSupported(false);
        setThreads((current) => {
          const next = clearBookingUnreadState(current);
          threadsRef.current = next;
          return next;
        });
        setError("");
        return { ok: false, unsupported: true };
      }
      if (!threadsRef.current.length) {
        setError(requestError.message || "Awarded conversations could not be loaded.");
      }
      return {
        ok: false,
        retryAfter: requestError?.retryAfter || null,
      };
    }).finally(() => {
      if (requestRef.current === request) requestRef.current = null;
      if (!controller.signal.aborted && enabledRef.current) {
        setLoading(false);
        setInitialized(true);
      }
    });
    requestRef.current = request;
    return request.promise;
  }, [audience]);

  useEffect(() => {
    if (!enabled) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      threadsRef.current = [];
      setThreads([]);
      setLoading(false);
      setInitialized(false);
      setError("");
      setUnreadSupported(null);
      setSummaryGeneration(0);
      unsupportedRef.current = false;
      return undefined;
    }

    let disposed = false;
    let timer = null;
    let running = false;
    let consecutiveFailures = 0;

    function schedule(delay = BOOKING_MESSAGE_POLL_INTERVAL_MS) {
      window.clearTimeout(timer);
      if (!disposed) timer = window.setTimeout(run, delay);
    }

    async function run(initial = false) {
      if (disposed || running || unsupportedRef.current) return;
      if (document.visibilityState !== "visible" || navigator.onLine === false) {
        schedule();
        return;
      }
      running = true;
      const result = await refresh({ initial });
      running = false;
      if (disposed || result.cancelled || result.unsupported) return;
      consecutiveFailures = result.ok ? 0 : consecutiveFailures + 1;
      schedule(bookingMessagePollDelay({
        consecutiveFailures,
        retryAfter: result.retryAfter,
      }));
    }

    function resume() {
      if (disposed || unsupportedRef.current || document.visibilityState !== "visible" || navigator.onLine === false) return;
      window.clearTimeout(timer);
      run(false);
    }

    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    run(true);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
  }, [enabled, refresh]);

  const updateThread = useCallback((bookingId, metadata = {}) => {
    if (!bookingId) return;
    const safeMetadata = { ...metadata };
    if (unsupportedRef.current) {
      delete safeMetadata.unreadMessageCount;
      delete safeMetadata.readThroughSequence;
    }
    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        if (thread.id !== bookingId) return thread;
        changed = true;
        const merged = mergeBookingThreadMetadata(thread, safeMetadata);
        return unsupportedRef.current ? clearBookingUnreadState([merged])[0] : merged;
      });
      if (!changed) return current;
      threadsRef.current = next;
      return next;
    });
  }, []);

  const unreadMessageCount = useMemo(() => (
    unreadSupported === false ? 0 : totalUnreadMessageCount(threads)
  ), [threads, unreadSupported]);

  return {
    threads,
    loading: Boolean(enabled && (!initialized || loading)),
    error,
    refresh,
    updateThread,
    unreadMessageCount,
    unreadSupported,
    summaryGeneration,
  };
}
