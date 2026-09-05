CREATE TABLE `platform_setting` (
  `id` VARCHAR(191) NOT NULL,
  `trialEnabled` BOOLEAN NOT NULL DEFAULT true,
  `trialDays` INTEGER NOT NULL DEFAULT 7,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subscription` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `planKey` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `provider` VARCHAR(191) NOT NULL DEFAULT 'abacatepay',
  `providerSubscriptionId` VARCHAR(191) NULL,
  `providerCustomerId` VARCHAR(191) NULL,
  `checkoutId` VARCHAR(191) NULL,
  `currentPeriodStart` DATETIME(3) NULL,
  `currentPeriodEnd` DATETIME(3) NULL,
  `trialEndsAt` DATETIME(3) NULL,
  `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `subscription_userId_key` (`userId`),
  INDEX `subscription_providerSubscriptionId_idx` (`providerSubscriptionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `processed_billing_event` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `externalId` VARCHAR(191) NOT NULL,
  `event` VARCHAR(191) NOT NULL,
  `payload` JSON NULL,
  `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `processed_billing_event_provider_externalId_key` (`provider`, `externalId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
