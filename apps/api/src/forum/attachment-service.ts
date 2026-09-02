import type { DatabaseSync } from "node:sqlite";
import type { RequestIdentity } from "../auth.js";
import { HttpError } from "../errors.js";

interface AttachmentRow {
  id: string;
  name: string;
  mime_type: string;
  price: number;
  author_id: string;
  download_url: string;
}

export class AttachmentService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** 读取附件并根据身份隐藏下载地址。 */
  attachment(attachmentId: string, identity: RequestIdentity) {
    const row = this.#db
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(attachmentId) as unknown as AttachmentRow | undefined;
    if (!row) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    const purchased =
      identity.id === row.author_id ||
      identity.role === "moderator" ||
      Boolean(
        this.#db
          .prepare(
            "SELECT 1 FROM attachment_purchases WHERE attachment_id = ? AND buyer_id = ?",
          )
          .get(attachmentId, identity.id),
      );
    return {
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      price: row.price,
      purchased,
      downloadUrl: purchased ? row.download_url : null,
    };
  }

  /** 幂等购买附件，并按售价向作者记入 70%。 */
  purchaseAttachment(attachmentId: string, identity: RequestIdentity) {
    const attachment = this.#db
      .prepare("SELECT * FROM attachments WHERE id = ?")
      .get(attachmentId) as unknown as AttachmentRow | undefined;
    if (!attachment)
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    if (identity.id === attachment.author_id || identity.role === "moderator") {
      return {
        attachment: this.attachment(attachmentId, identity),
        buyerBalance: this.#wallet(identity.id),
        authorIncome: 0,
        alreadyPurchased: true,
      };
    }

    const income = Math.floor(attachment.price * 0.7);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#db
        .prepare(
          "SELECT author_income FROM attachment_purchases WHERE attachment_id = ? AND buyer_id = ?",
        )
        .get(attachmentId, identity.id) as { author_income: number } | undefined;
      if (existing) {
        const balance = this.#wallet(identity.id);
        this.#db.exec("COMMIT");
        return {
          attachment: this.attachment(attachmentId, identity),
          buyerBalance: balance,
          authorIncome: existing.author_income,
          alreadyPurchased: true,
        };
      }
      const balance = this.#wallet(identity.id);
      const debit = this.#db
        .prepare(
          "UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
        )
        .run(attachment.price, identity.id, attachment.price);
      if (debit.changes !== 1) {
        throw new HttpError(402, "INSUFFICIENT_COINS", "金币不足", {
          balance,
          price: attachment.price,
        });
      }
      this.#db
        .prepare("UPDATE wallets SET balance = balance + ? WHERE user_id = ?")
        .run(income, attachment.author_id);
      this.#db
        .prepare(
          "INSERT INTO attachment_purchases(attachment_id, buyer_id, price, author_income, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(attachment.id, identity.id, attachment.price, income, new Date().toISOString());
      this.#db.exec("COMMIT");
      return {
        attachment: this.attachment(attachmentId, identity),
        buyerBalance: balance - attachment.price,
        authorIncome: income,
        alreadyPurchased: false,
      };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #wallet(userId: string): number {
    const row = this.#db
      .prepare("SELECT balance FROM wallets WHERE user_id = ?")
      .get(userId) as { balance: number } | undefined;
    return row?.balance ?? 0;
  }
}
