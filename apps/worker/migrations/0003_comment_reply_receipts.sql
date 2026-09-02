-- 回复与回执必须处于同一数据库事务，避免正文已回复但门禁仍锁定。
CREATE TRIGGER comment_reply_creates_receipt
AFTER INSERT ON comment_replies
BEGIN
  INSERT OR IGNORE INTO reply_receipts(document_id, user_id, created_at)
  VALUES (NEW.document_id, NEW.author_id, NEW.created_at);
END;
