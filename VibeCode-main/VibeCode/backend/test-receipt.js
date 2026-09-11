/**
 * Test helper: generates a realistic receipt image (PNG) at backend/test-receipt.png
 * using sharp + SVG. Used only for verifying the /api/purchases/scan pipeline.
 */
const sharp = require('sharp');
const path = require('path');

const svg = `<svg width="640" height="900" xmlns="http://www.w3.org/2000/svg">
  <rect width="640" height="900" fill="#ffffff"/>
  <text x="320" y="60" font-family="Courier New" font-size="30" font-weight="bold" text-anchor="middle">TECH MART ELECTRONICS</text>
  <text x="320" y="95" font-family="Courier New" font-size="18" text-anchor="middle">123 Main Street, Karachi</text>
  <text x="320" y="120" font-family="Courier New" font-size="18" text-anchor="middle">Tel: 021-34567890</text>
  <text x="320" y="170" font-family="Courier New" font-size="20" text-anchor="middle">--------------------------------</text>
  <text x="60" y="215" font-family="Courier New" font-size="22">Date: 2026-09-05   Time: 14:32</text>
  <text x="60" y="245" font-family="Courier New" font-size="22">Invoice No: TM-2026-88417</text>
  <text x="320" y="295" font-family="Courier New" font-size="20" text-anchor="middle">--------------------------------</text>
  <text x="60" y="345" font-family="Courier New" font-size="24" font-weight="bold">Sony WH-1000XM5</text>
  <text x="60" y="380" font-family="Courier New" font-size="20">Wireless Noise Cancelling</text>
  <text x="60" y="415" font-family="Courier New" font-size="20">Headphones</text>
  <text x="60" y="455" font-family="Courier New" font-size="22">Qty: 1          Rs 74,999</text>
  <text x="320" y="505" font-family="Courier New" font-size="20" text-anchor="middle">--------------------------------</text>
  <text x="60" y="550" font-family="Courier New" font-size="22">Subtotal:       Rs 74,999</text>
  <text x="60" y="585" font-family="Courier New" font-size="22">Tax (5%):       Rs 3,750</text>
  <text x="60" y="635" font-family="Courier New" font-size="26" font-weight="bold">TOTAL:          Rs 78,749</text>
  <text x="320" y="685" font-family="Courier New" font-size="20" text-anchor="middle">--------------------------------</text>
  <text x="60" y="730" font-family="Courier New" font-size="22">Payment: Visa Card ****4410</text>
  <text x="60" y="780" font-family="Courier New" font-size="20">Warranty: 12 months manufacturer</text>
  <text x="60" y="810" font-family="Courier New" font-size="20">Return policy: 30 days with receipt</text>
  <text x="60" y="840" font-family="Courier New" font-size="20">Serial: SN-XM5-8841732</text>
  <text x="320" y="880" font-family="Courier New" font-size="20" text-anchor="middle">Thank you for shopping with us!</text>
</svg>`;

sharp(Buffer.from(svg))
  .png()
  .toFile(path.join(__dirname, 'test-receipt.png'))
  .then(info => console.log('Created test-receipt.png', info.width + 'x' + info.height))
  .catch(err => { console.error(err); process.exit(1); });
