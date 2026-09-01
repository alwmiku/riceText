import type { DatabaseSync } from "node:sqlite";
import type { TiptapDocument } from "@ricetext/contracts";
import type { RequestIdentity } from "../auth.js";
import { HttpError } from "../errors.js";

export class ReplyGateService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** 按已回复记录解析隐藏内容。 */
  replyGate(
    gateId: string,
    documentId: string,
    identity: RequestIdentity,
  ): { visible: boolean; content: TiptapDocument | null; message: string } {
    const row = this.#db
      .prepare("SELECT document_id, content_json FROM reply_gates WHERE id = ?")
      .get(gateId) as { document_id: string; content_json: string } | undefined;
    if (!row || row.document_id !== documentId)
      throw new HttpError(404, "REPLY_GATE_NOT_FOUND", "回复可见内容不存在");
    const visible =
      identity.role !== "reader" ||
      Boolean(
        this.#db
          .prepare(
            "SELECT 1 FROM reply_receipts WHERE document_id = ? AND user_id = ?",
          )
          .get(documentId, identity.id),
      );
    return {
      visible,
      content: visible
        ? (JSON.parse(row.content_json) as TiptapDocument)
        : null,
      message: visible ? "已满足查看条件" : "回复主帖后可见",
    };
  }
}
