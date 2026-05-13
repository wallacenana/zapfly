const fs = require('fs');
let s = fs.readFileSync('prisma/schema.prisma', 'utf8');
const models = [
  'Instance', 'Product', 'Category', 'Order', 'Customer',
  'StockItem', 'AvailableSlot', 'CalendarEvent', 'Setting',
  'MarketingAsset', 'SeasonalCatalog'
];

models.forEach(model => {
  const regex = new RegExp(`model ${model} \\{`);
  s = s.replace(regex, `model ${model} {\n  userId    String?\n  user      User?     @relation(fields: [userId], references: [id])`);
});

s += `

model User {
  id String @id @default(uuid())
  email String @unique
  password String
  name String
  role String @default("USER")
  phone String?
  otpSecret String?
  active Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  instances Instance[]
  products Product[]
  categories Category[]
  orders Order[]
  customers Customer[]
  stockItems StockItem[]
  settings Setting[]
  marketingAssets MarketingAsset[]
  seasonalCatalogs SeasonalCatalog[]
  availableSlots AvailableSlot[]
  calendarEvents CalendarEvent[]
  @@map("user")
}
`;

fs.writeFileSync('prisma/schema.prisma', s);
console.log("Schema updated.");
