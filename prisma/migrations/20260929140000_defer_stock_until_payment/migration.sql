-- Pending-payment orders must not reserve stock. Existing delivery orders were
-- created under the old reservation flow, so mark them as already accounted.
ALTER TABLE `order` ADD COLUMN `stockDeducted` BOOLEAN NOT NULL DEFAULT false;

UPDATE `order`
SET `stockDeducted` = true
WHERE LOWER(COALESCE(`type`, '')) = 'delivery';
