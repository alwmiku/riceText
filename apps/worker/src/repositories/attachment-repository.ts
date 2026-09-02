import {
  AttachmentSchema,
  PurchaseAttachmentResponseSchema,
  type Attachment,
  type ForumUser,
} from "@ricetext/contracts";
import { WorkerHttpError } from "../http-error";

type AttachmentRow = {
  id: string;
  name: string;
  mime_type: string;
  price: number;
  author_id: string;
  asset_id: string | null;
  legacy_download_url: string | null;
};

/** 附件权益仓储；扣款、作者分成和购买记录由 D1 触发器在同一事务内完成。 */
export class D1AttachmentRepository {
  constructor(private readonly db: D1Database) {}

  private async row(attachmentId: string): Promise<AttachmentRow> {
    const row = await this.db
      .prepare(
        "SELECT id, name, mime_type, price, author_id, asset_id, legacy_download_url " +
          "FROM attachments WHERE id = ?",
      )
      .bind(attachmentId)
      .first<AttachmentRow>();
    if (!row) throw new WorkerHttpError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    return row;
  }

  private async balance(userId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT balance FROM wallets WHERE user_id = ?")
      .bind(userId)
      .first<{ balance: number }>();
    return row?.balance ?? 0;
  }

  private downloadUrl(row: AttachmentRow): string | null {
    if (row.asset_id) return "/api/assets/" + row.asset_id;
    return row.legacy_download_url;
  }

  async attachment(attachmentId: string, principal: ForumUser): Promise<Attachment> {
    const row = await this.row(attachmentId);
    const purchase = await this.db
      .prepare(
        "SELECT 1 AS purchased FROM attachment_purchases " +
          "WHERE attachment_id = ? AND buyer_id = ?",
      )
      .bind(attachmentId, principal.id)
      .first<{ purchased: number }>();
    const purchased =
      principal.id === row.author_id || principal.role === "moderator" || Boolean(purchase);
    return AttachmentSchema.parse({
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      price: row.price,
      purchased,
      downloadUrl: purchased ? this.downloadUrl(row) : null,
    });
  }

  async purchase(
    attachmentId: string,
    principal: ForumUser,
  ): Promise<ReturnType<typeof PurchaseAttachmentResponseSchema.parse>> {
    const attachment = await this.row(attachmentId);
    const existing = await this.db
      .prepare(
        "SELECT author_income FROM attachment_purchases " +
          "WHERE attachment_id = ? AND buyer_id = ?",
      )
      .bind(attachmentId, principal.id)
      .first<{ author_income: number }>();
    if (
      existing ||
      principal.id === attachment.author_id ||
      principal.role === "moderator"
    ) {
      return PurchaseAttachmentResponseSchema.parse({
        attachment: await this.attachment(attachmentId, principal),
        buyerBalance: await this.balance(principal.id),
        authorIncome: existing?.author_income ?? 0,
        alreadyPurchased: true,
      });
    }

    const balance = await this.balance(principal.id);
    if (balance < attachment.price) {
      throw new WorkerHttpError(402, "INSUFFICIENT_COINS", "金币不足", {
        balance,
        price: attachment.price,
      });
    }
    const income = Math.floor(attachment.price * 0.7);
    try {
      await this.db
        .prepare(
          "INSERT INTO attachment_purchases(" +
            "attachment_id, buyer_id, price, author_income, created_at" +
            ") VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          attachment.id,
          principal.id,
          attachment.price,
          income,
          new Date().toISOString(),
        )
        .run();
    } catch (error) {
      const concurrent = await this.db
        .prepare(
          "SELECT author_income FROM attachment_purchases " +
            "WHERE attachment_id = ? AND buyer_id = ?",
        )
        .bind(attachmentId, principal.id)
        .first<{ author_income: number }>();
      if (concurrent) {
        return PurchaseAttachmentResponseSchema.parse({
          attachment: await this.attachment(attachmentId, principal),
          buyerBalance: await this.balance(principal.id),
          authorIncome: concurrent.author_income,
          alreadyPurchased: true,
        });
      }
      const currentBalance = await this.balance(principal.id);
      if (currentBalance < attachment.price) {
        throw new WorkerHttpError(402, "INSUFFICIENT_COINS", "金币不足", {
          balance: currentBalance,
          price: attachment.price,
        });
      }
      throw error;
    }
    return PurchaseAttachmentResponseSchema.parse({
      attachment: await this.attachment(attachmentId, principal),
      buyerBalance: await this.balance(principal.id),
      authorIncome: income,
      alreadyPurchased: false,
    });
  }
}
