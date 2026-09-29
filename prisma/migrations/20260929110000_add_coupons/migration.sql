CREATE TABLE `coupon` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `discountType` VARCHAR(191) NOT NULL DEFAULT 'fixed',
  `discountValue` DOUBLE NOT NULL DEFAULT 0,
  `freeDelivery` BOOLEAN NOT NULL DEFAULT false,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `usageLimit` INTEGER NULL,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `validFrom` DATETIME(3) NULL,
  `validUntil` DATETIME(3) NULL,
  `orderSlots` TEXT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `coupon_userId_code_key`(`userId`, `code`),
  INDEX `coupon_userId_active_idx`(`userId`, `active`),
  PRIMARY KEY (`id`),
  CONSTRAINT `coupon_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order` ADD COLUMN `couponCode` VARCHAR(191) NULL, ADD COLUMN `couponDiscount` DOUBLE NOT NULL DEFAULT 0;
