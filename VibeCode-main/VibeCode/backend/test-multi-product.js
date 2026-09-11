/**
 * Test: multi-product bill parsing
 * Simulates OCR output from a bill containing 2 products + GST lines.
 */
const AiReceiptParser = require('./services/aiReceiptParser');

const multiProductBill = `
TechMart Electronics Pvt. Ltd.
Shop No. 12, Hitech City, Hyderabad - 500081
GSTIN: 36AAABC1234D1Z5

TAX INVOICE
Invoice No: INV-2024-0081   Date: 05/09/2026

S.No  Description                      Qty  Rate      Amount
1     Apple iPhone 15 Pro 256GB          1   79000     79000
2     Samsung Galaxy Buds2 Pro           2   10000     20000

Subtotal:                                             99000
CGST (9%):                                             8910
SGST (9%):                                             8910
Grand Total:                                         116820

Warranty: 1 Year Manufacturer Warranty
Return Policy: 7 day return window
Payment: Visa Card
Thank you for shopping!
`;

const result = AiReceiptParser.parseReceiptText(multiProductBill, 'test_invoice.jpg');

console.log('\n=== BILL-LEVEL FIELDS ===');
console.log('productName  :', result.productName);
console.log('merchant     :', result.storeName);
console.log('price (total):', result.price);
console.log('invoiceNumber:', result.invoiceNumber);
console.log('purchaseDate :', result.purchaseDate);
console.log('warrantyMonths:', result.warrantyMonths);
console.log('returnDays   :', result.returnPeriodDays);
console.log('currency     :', result.currency);
console.log('tax          :', result.tax);

console.log('\n=== ITEMS ARRAY ===');
console.log(JSON.stringify(result.items, null, 2));

console.log('\n=== VALIDATION ===');
const pass = (label, condition) => {
  const ok = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`${ok}  ${label}`);
};

pass('items is an array',                   Array.isArray(result.items));
pass('items has 2 entries',                 result.items.length === 2);
pass('item[0] has productName',             !!result.items[0]?.productName);
pass('item[0] productName is iPhone 15',    result.items[0]?.productName?.toLowerCase().includes('iphone'));
pass('item[1] productName is Buds2',        result.items[1]?.productName?.toLowerCase().includes('galaxy') || result.items[1]?.productName?.toLowerCase().includes('buds'));
pass('item[0] brand = Apple',               result.items[0]?.brand === 'Apple');
pass('item[1] brand = Samsung',             result.items[1]?.brand === 'Samsung');
pass('item[0] category = Electronics',      result.items[0]?.category === 'Electronics');
pass('item[1] category = Electronics',      result.items[1]?.category === 'Electronics');
pass('item[0] has quantity field',          result.items[0]?.quantity !== undefined);
pass('item[0] price populated',             result.items[0]?.price !== undefined);
pass('serialNumber = null per item',        result.items[0]?.serialNumber === null);
pass('warrantyMonths = null per item',      result.items[0]?.warrantyMonths === null);
pass('returnPeriodDays = null per item',    result.items[0]?.returnPeriodDays === null);
pass('GST not in items',                    !result.items.some(it => /cgst|sgst|gst|tax/i.test(it.productName || '')));
pass('Grand Total not in items',            !result.items.some(it => /grand total|subtotal/i.test(it.productName || '')));
pass('bill-level warrantyMonths = 12',      result.warrantyMonths === 12);
pass('bill-level returnPeriodDays = 7',     result.returnPeriodDays === 7);
pass('bill-level price = 116820',           result.price === 116820);
