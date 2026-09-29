ALTER TABLE `available_slot`
  ADD COLUMN `slotType` VARCHAR(20) NOT NULL DEFAULT 'delivery' AFTER `maxOrders`;

INSERT INTO `available_slot` (`id`, `dayOfWeek`, `startTime`, `endTime`, `maxOrders`, `slotType`, `userId`, `createdAt`, `updatedAt`)
SELECT UUID(), source.`dayOfWeek`, source.`startTime`, source.`endTime`, source.`maxOrders`, 'order', source.`userId`, NOW(), NOW()
FROM `available_slot` AS source
WHERE source.`slotType` = 'delivery'
  AND NOT EXISTS (
    SELECT 1
    FROM `available_slot` AS target
    WHERE target.`userId` = source.`userId`
      AND target.`dayOfWeek` = source.`dayOfWeek`
      AND target.`startTime` = source.`startTime`
      AND target.`endTime` = source.`endTime`
      AND target.`slotType` = 'order'
  );
