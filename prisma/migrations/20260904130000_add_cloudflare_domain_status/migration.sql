ALTER TABLE `store_profile`
  ADD COLUMN `customDomainStatus` VARCHAR(191) NOT NULL DEFAULT 'not_configured',
  ADD COLUMN `cloudflareHostnameId` VARCHAR(191) NULL,
  ADD COLUMN `cloudflareSslStatus` VARCHAR(191) NULL,
  ADD COLUMN `cloudflareValidationRecords` JSON NULL,
  ADD COLUMN `customDomainLastError` TEXT NULL;
