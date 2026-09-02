-- 购买检查和余额转移放在触发器内，跨 Worker 实例并发时也不会透支或重复扣款。
CREATE TRIGGER attachment_purchase_checks_balance
BEFORE INSERT ON attachment_purchases
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT balance FROM wallets WHERE user_id = NEW.buyer_id), 0) < NEW.price
    THEN RAISE(ABORT, 'INSUFFICIENT_COINS')
  END;
END;

CREATE TRIGGER attachment_purchase_moves_balance
AFTER INSERT ON attachment_purchases
BEGIN
  UPDATE wallets
  SET balance = balance - NEW.price
  WHERE user_id = NEW.buyer_id;

  INSERT INTO wallets(user_id, balance)
  SELECT author_id, NEW.author_income FROM attachments WHERE id = NEW.attachment_id
  ON CONFLICT(user_id) DO UPDATE SET balance = balance + NEW.author_income;
END;
