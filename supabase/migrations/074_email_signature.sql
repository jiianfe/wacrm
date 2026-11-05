-- 074_email_signature.sql — the company's e-mail signature
--
-- One formatted (sanitized HTML) signature per mailbox, edited in
-- Settings → E-mail and appended to replies sent from the inbox.
-- `{{nome}}` inside it is replaced by the sender's name at send time.

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS signature_html TEXT
  CHECK (signature_html IS NULL OR char_length(signature_html) <= 20000);
