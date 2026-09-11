/**
 * Seed Sample Purchases into MongoDB — WarrantyVault AI
 *
 * Creates the preloaded sample receipts (Electronics, Home Appliances, Fashion,
 * Furniture, Food & Groceries, Food & Beverages, Sports & Fitness, Office,
 * Gadgets) as real purchase documents in MongoDB for every registered user,
 * so the dashboard, returns, warranties and claims sections have rich data.
 *
 * Idempotent: skips products that already exist for a user.
 *
 * Usage:  node seed-samples.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');
const { connectDB } = require('./config/db');
const User = require('./models/User');
const Purchase = require('./models/Purchase');
const PurchaseService = require('./services/purchaseService');
const AiReceiptParser = require('./services/aiReceiptParser');

async function seed() {
  await connectDB();

  const samples = AiReceiptParser.getSampleReceipts();
  const users = await User.find({});

  let totalCreated = 0;

  for (const user of users) {
    for (const sample of samples) {
      const data = sample.data;
      const existing = await Purchase.findOne({
        userId: String(user._id),
        productName: data.productName
      }).catch(() => null);

      if (existing) continue;

      try {
        await PurchaseService.createPurchase(String(user._id), data);
        totalCreated += 1;
        console.log(`  + seeded "${data.productName}" (${data.category}) for ${user.email}`);
      } catch (err) {
        console.warn(`  ! failed to seed "${data.productName}":`, err.message);
      }
    }
  }

  console.log(`\nDone. Created ${totalCreated} sample purchase document(s) in MongoDB.`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
