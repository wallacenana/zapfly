ALTER TABLE `user` ADD COLUMN `googleId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `user_googleId_key` ON `user`(`googleId`);
