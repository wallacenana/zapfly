-- AlterTable
ALTER TABLE "Instance" ADD COLUMN "botPrompt" TEXT DEFAULT 'Você é um assistente virtual prestativo.';
ALTER TABLE "Instance" ADD COLUMN "knowledge" TEXT DEFAULT '[]';

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMsg" TEXT,
    "lastMsgTime" TEXT,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chat_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "msgId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "participant" TEXT,
    "senderName" TEXT,
    "quotedText" TEXT,
    "quotedParticipant" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'sent',
    CONSTRAINT "Message_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_instanceId_jid_fkey" FOREIGN KEY ("instanceId", "jid") REFERENCES "Chat" ("instanceId", "jid") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "clientName" TEXT,
    "clientJid" TEXT,
    "product" TEXT NOT NULL,
    "quantity" TEXT,
    "notes" TEXT,
    "scheduledDate" TEXT NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "calendarEventId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'order',
    "deliveryAddress" TEXT,
    "forwardedTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "quantity" REAL NOT NULL DEFAULT 0,
    "minQuantity" REAL NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unidade'
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantityPer" REAL NOT NULL,
    CONSTRAINT "Ingredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ingredient_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AvailableSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "maxOrders" INTEGER NOT NULL DEFAULT 3
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "openaiKey" TEXT,
    "claudeKey" TEXT,
    "activeModel" TEXT NOT NULL DEFAULT 'openai',
    "gcalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gcalCredentials" TEXT,
    "gcalCalendarId" TEXT,
    "gcalSyncHour" INTEGER NOT NULL DEFAULT 6,
    "businessName" TEXT,
    "managerJid" TEXT,
    "deliveryJid" TEXT,
    "reportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reportHour" INTEGER NOT NULL DEFAULT 7
);
INSERT INTO "new_Setting" ("activeModel", "claudeKey", "id", "openaiKey") SELECT "activeModel", "claudeKey", "id", "openaiKey" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Chat_instanceId_jid_key" ON "Chat"("instanceId", "jid");

-- CreateIndex
CREATE UNIQUE INDEX "Message_msgId_key" ON "Message"("msgId");

-- CreateIndex
CREATE INDEX "Message_instanceId_jid_idx" ON "Message"("instanceId", "jid");
