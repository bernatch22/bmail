/**
 * threading.ts — Conversation threading for the local mail store.
 *
 * Extracted from bermail packages/db/src/repository.ts, where the algorithm
 * was welded to SQLite queries. Here the DECISION logic is pure: the caller
 * injects a ThreadLookup that answers the two questions the algorithm needs
 * (parent by Message-ID, existing thread by normalized subject), and this
 * module decides which thread a message belongs to.
 *
 * ../store imports normalizeSubject from here (one implementation, unit
 * tested in test/threading.test.mjs). Its computeThreadId is still a private
 * SQL-bound method: porting it onto the ThreadLookup interface below is the
 * remaining piece, and it changes behaviour, so it is not a rename job.
 */

// ─── Subject normalization ─────────────────────────────

/**
 * Normalize a subject for threading: strip any run of Re:/Fwd:/Fw: prefixes,
 * trim, lowercase. "Re: Re: Fwd: Hello" → "hello".
 */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/gi, '')
    .trim()
    .toLowerCase();
}

/**
 * True when the subject carries a reply/forward prefix. Only such messages
 * are allowed to join a thread by subject — a brand-new "Hello" must never
 * glue itself onto an old conversation that happened to share the words.
 */
export function isReplySubject(subject: string): boolean {
  return /^(re|fwd|fw)\s*:/i.test(subject);
}

// ─── Thread id computation ─────────────────────────────

/**
 * The two lookups the algorithm needs, answered by whoever owns the message
 * store (in practice ../store). Return null when nothing matches.
 */
export interface ThreadLookup {
  /** Thread id of the message whose Message-ID equals `messageId`, if any. */
  findThreadIdByMessageId(messageId: string): string | null;

  /**
   * Thread id of an existing message whose normalizeSubject() equals
   * `normalizedSubject`, excluding the message identified by
   * `excludingMessageId` (so a message never matches itself). Prefer the
   * OLDEST match, so late copies join the original thread.
   */
  findThreadIdByNormalizedSubject(
    normalizedSubject: string,
    excludingMessageId: string,
  ): string | null;
}

/** The headers of the incoming message that drive threading. */
export interface ThreadingHeaders {
  messageId?: string;
  inReplyTo?: string;
  subject?: string;
}

/**
 * JWZ-inspired hybrid threading:
 *
 *   Phase 1: In-Reply-To → find parent by Message-ID → join parent's thread.
 *   Phase 2: Subject grouping, ONLY for Re:/Fwd: subjects without a resolvable
 *            In-Reply-To (e.g. Outlook sent copies) → join the oldest thread
 *            with the same normalized subject.
 *   Phase 3: New thread → own Message-ID as thread id (globally unique).
 *   Fallback: normalized subject, for pathological messages with no headers.
 */
export function computeThreadId(
  headers: ThreadingHeaders,
  lookup: ThreadLookup,
): string {
  const { messageId, inReplyTo, subject } = headers;

  // Phase 1: In-Reply-To header lookup (most reliable, RFC 5322).
  if (inReplyTo) {
    const parentThreadId = lookup.findThreadIdByMessageId(inReplyTo);
    if (parentThreadId) {
      return parentThreadId;
    }
  }

  // Phase 2: subject grouping — only replies/forwards may join by subject.
  if (isReplySubject(subject ?? '')) {
    const normalized = normalizeSubject(subject ?? '');
    if (normalized) {
      const existingThreadId = lookup.findThreadIdByNormalizedSubject(
        normalized,
        messageId ?? '',
      );
      if (existingThreadId) {
        return existingThreadId;
      }
    }
  }

  // Phase 3: new thread — the message's own Message-ID.
  if (messageId) {
    return messageId;
  }

  // Absolute fallback for messages without any usable headers.
  return normalizeSubject(subject ?? '');
}
