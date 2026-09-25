CREATE TABLE `delivery_record` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `deliveryDate` DATETIME(3) NOT NULL,
  `clientName` VARCHAR(191) NULL,
  `deliveryAddress` TEXT NULL,
  `deliveryFee` DOUBLE NOT NULL DEFAULT 0,
  `orderValue` DOUBLE NOT NULL DEFAULT 0,
  `paymentMethod` VARCHAR(191) NULL,
  `paymentReceived` BOOLEAN NOT NULL DEFAULT false,
  `deliveryPerson` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `delivery_record_userId_deliveryDate_idx`(`userId`, `deliveryDate`),
  PRIMARY KEY (`id`)
);
