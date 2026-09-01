import type { DatabaseSync } from "node:sqlite";
import type {
  DocumentEnvelope,
  ForumUser,
  TiptapDocument,
} from "@ricetext/contracts";
import type { RequestIdentity } from "./auth.js";
import type { DocumentService } from "./document-service.js";
import { AttachmentService } from "./forum/attachment-service.js";
import { ChapterService } from "./forum/chapter-service.js";
import { PollService } from "./forum/poll-service.js";
import { ReplyGateService } from "./forum/reply-gate-service.js";
import { SessionService } from "./forum/session-service.js";
import { SuggestionService } from "./forum/suggestion-service.js";
import type {
  mapSuggestion,
  mapSuggestionBatch,
} from "./forum/suggestion-service.js";

/** Compatibility facade for forum domain services. */
export class ForumService {
  readonly #attachments: AttachmentService;
  readonly #chapters: ChapterService;
  readonly #polls: PollService;
  readonly #replyGates: ReplyGateService;
  readonly #session: SessionService;
  readonly #suggestions: SuggestionService;

  constructor(db: DatabaseSync, documents: DocumentService) {
    this.#attachments = new AttachmentService(db);
    this.#chapters = new ChapterService(db);
    this.#polls = new PollService(db);
    this.#replyGates = new ReplyGateService(db);
    this.#session = new SessionService(db);
    this.#suggestions = new SuggestionService(db, documents);
  }

  users(): ForumUser[] {
    return this.#session.users();
  }

  searchUsers(query: string, friendsOnly: boolean): ForumUser[] {
    return this.#session.searchUsers(query, friendsOnly);
  }

  resolveMention(
    name: string,
    userId: string | undefined,
  ): { resolved: boolean; displayText: string; user: ForumUser | null } {
    return this.#session.resolveMention(name, userId);
  }

  chapters(): Array<{
    id: string;
    title: string;
    order: number;
    documentId: string;
    revision: number;
  }> {
    return this.#chapters.chapters();
  }

  chapterHashes(documentId: string): Map<string, string | null> {
    return this.#chapters.chapterHashes(documentId);
  }

  saveChapter(
    documentId: string,
    chapterId: string,
    input: {
      title: string;
      order: number;
      content: TiptapDocument;
      hash: string;
      baseRevision: number;
    },
  ): { id: string; title: string; order: number; revision: number } {
    return this.#chapters.saveChapter(documentId, chapterId, input);
  }

  suggestions(documentId: string, identity: RequestIdentity) {
    return this.#suggestions.suggestions(documentId, identity);
  }

  suggestionBatches(documentId: string, identity: RequestIdentity) {
    return this.#suggestions.suggestionBatches(documentId, identity);
  }

  createSuggestionBatch(
    documentId: string,
    input: {
      baseRevision: number;
      chapterId: string;
      chapterTitle: string;
      beforeContent: TiptapDocument;
      afterContent: TiptapDocument;
      steps: Array<Record<string, unknown>>;
      reason: string;
    },
    identity: RequestIdentity,
  ) {
    return this.#suggestions.createSuggestionBatch(documentId, input, identity);
  }

  reviewSuggestionBatch(
    batchId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    identity: RequestIdentity,
  ): { batch: ReturnType<typeof mapSuggestionBatch>; document: DocumentEnvelope | null } {
    return this.#suggestions.reviewSuggestionBatch(
      batchId,
      decision,
      baseRevision,
      identity,
    );
  }

  createSuggestion(
    documentId: string,
    fromText: string,
    toText: string,
    reason: string,
    identity: RequestIdentity,
    location: {
      chapterId: string;
      chapterTitle: string;
      lineNo: number;
      lineText: string;
    },
  ) {
    return this.#suggestions.createSuggestion(
      documentId,
      fromText,
      toText,
      reason,
      identity,
      location,
    );
  }

  reviewSuggestion(
    suggestionId: string,
    decision: "approve" | "reject",
    baseRevision: number,
    identity: RequestIdentity,
  ): {
    suggestion: ReturnType<typeof mapSuggestion>;
    document: DocumentEnvelope | null;
  } {
    return this.#suggestions.reviewSuggestion(
      suggestionId,
      decision,
      baseRevision,
      identity,
    );
  }

  replyGate(
    gateId: string,
    documentId: string,
    identity: RequestIdentity,
  ): { visible: boolean; content: TiptapDocument | null; message: string } {
    return this.#replyGates.replyGate(gateId, documentId, identity);
  }

  attachment(attachmentId: string, identity: RequestIdentity) {
    return this.#attachments.attachment(attachmentId, identity);
  }

  purchaseAttachment(attachmentId: string, identity: RequestIdentity) {
    return this.#attachments.purchaseAttachment(attachmentId, identity);
  }

  poll(pollId: string, identity: RequestIdentity) {
    return this.#polls.poll(pollId, identity);
  }

  votePoll(pollId: string, optionIds: string[], identity: RequestIdentity) {
    return this.#polls.votePoll(pollId, optionIds, identity);
  }

  pollVotes(pollId: string, cursor: string | undefined, limit: number) {
    return this.#polls.pollVotes(pollId, cursor, limit);
  }
}
