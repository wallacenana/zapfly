ALTER TABLE `chat`
  ADD COLUMN `aiManuallyPaused` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `chat`
  ALTER COLUMN `aiEnabled` SET DEFAULT false;
