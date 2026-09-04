ALTER TABLE `store_profile` ADD COLUMN `customDomain` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `store_profile_customDomain_key` ON `store_profile`(`customDomain`);
