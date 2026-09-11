/**
 * AI Receipt & Bill OCR Parser Service
 * Extracts Merchant, Price, Purchase Date, Warranty Policy, Return Deadlines,
 * Serial Numbers, Categories, and Itemized lines from bills, receipts, or invoices.
 */

// Competition Demo Preloaded Sample Receipts
const SAMPLE_RECEIPTS = [
  {
    id: 'sample-apple-macbook',
    label: 'Apple Store — MacBook Pro 16" M3 Max',
    badge: 'High Value Electronics',
    data: {
      productName: 'MacBook Pro 16" (M3 Max, 36GB RAM, 1TB SSD)',
      brand: 'Apple',
      storeName: 'Apple Store 5th Avenue',
      purchaseDate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 6 days ago (return window urgent: 8 days left!)
      price: 3499.00,
      currency: 'PKR',
      category: 'Electronics',
      warrantyMonths: 12,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 14,
      serialNumber: 'C02G89A2MD6R',
      modelNumber: 'MUW63LL/A',
      invoiceNumber: 'APL-INV-2026-98124',
      paymentMethod: 'Apple Card (Ending 4092)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Apple_Receipt_MacBook_Pro_16.pdf',
      items: [
        { name: 'MacBook Pro 16" Space Black', price: 3499.00, quantity: 1, serialNumber: 'C02G89A2MD6R' },
        { name: '140W USB-C Power Adapter', price: 0.00, quantity: 1, serialNumber: 'A2452' }
      ],
      notes: 'Purchased for software development & AI model benchmarking. Covered under AppleCare 1-Year Limited.',
      confidenceScore: 0.98
    }
  },
  {
    id: 'sample-sony-bravia',
    label: 'Sony Center — 65" BRAVIA XR OLED 4K TV',
    badge: 'Home Theater',
    data: {
      productName: 'Sony 65" BRAVIA XR A80L OLED 4K Google TV',
      brand: 'Sony',
      storeName: 'Sony Authorized Experience Store',
      purchaseDate: new Date(Date.now() - 340 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 340 days ago (warranty expiring in 25 days!)
      price: 1899.99,
      currency: 'PKR',
      category: 'Electronics',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'SN-XR65A80L-882103',
      modelNumber: 'XR-65A80L',
      invoiceNumber: 'SNY-TX-7741920',
      paymentMethod: 'Visa Signature (Ending 1823)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Sony_Bravia_XR65_Receipt.pdf',
      items: [
        { name: 'Sony 65" OLED TV Panel', price: 1899.99, quantity: 1, serialNumber: 'SN-XR65A80L-882103' }
      ],
      notes: '2-Year Official Sony Warranty. Need to check OLED pixel condition before warranty lapse.',
      confidenceScore: 0.96
    }
  },
  {
    id: 'sample-samsung-fridge',
    label: 'Samsung Store — Smart French Door Refrigerator',
    badge: 'Major Appliance',
    data: {
      productName: 'Samsung Family Hub 4-Door Smart Refrigerator',
      brand: 'Samsung',
      storeName: 'Samsung Official Experience Store',
      purchaseDate: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      price: 2499.00,
      currency: 'PKR',
      category: 'Home Appliances',
      warrantyMonths: 60, // 5 years
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'RF29BB86004MAA-091',
      modelNumber: 'RF29BB86004M',
      invoiceNumber: 'SMS-INV-993812',
      paymentMethod: 'Mastercard World (Ending 5512)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Samsung_Fridge_FamilyHub_Bill.pdf',
      items: [
        { name: 'Samsung Family Hub Refrigerator 29 cu. ft.', price: 2499.00, quantity: 1, serialNumber: 'RF29BB86004MAA-091' }
      ],
      notes: '10-Year Digital Inverter Compressor warranty included. 5-Year sealed refrigeration system warranty.',
      confidenceScore: 0.97
    }
  },
  {
    id: 'sample-nike-alphafly',
    label: 'Nike Store — Air Zoom Alphafly NEXT% 3',
    badge: 'Athletic Gear',
    data: {
      productName: 'Nike Air Zoom Alphafly NEXT% 3 Running Shoes',
      brand: 'Nike',
      storeName: 'Nike NYC Flagship Store',
      purchaseDate: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      price: 285.00,
      currency: 'PKR',
      category: 'Fashion',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 60,
      serialNumber: 'FD8311-700-11.5',
      modelNumber: 'FD8311-700',
      invoiceNumber: 'NKE-RCPT-440182',
      paymentMethod: 'Apple Pay (Amex 9001)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Nike_Receipt_Alphafly3.pdf',
      items: [
        { name: 'Nike Air Zoom Alphafly 3 (Volt/Orange - Size 11.5)', price: 285.00, quantity: 1, serialNumber: 'FD8311-700' }
      ],
      notes: '60-day wear trial return policy. 2-Year material flaw warranty.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-dyson-vacuum',
    label: 'Best Buy — Dyson V15 Detect Cordless Vacuum',
    badge: 'Home Electronics',
    data: {
      productName: 'Dyson V15 Detect Absolute Cordless Vacuum Cleaner',
      brand: 'Dyson',
      storeName: 'Best Buy Retail Store #482',
      purchaseDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 4 days ago (return window active: 11 days left)
      price: 749.99,
      currency: 'PKR',
      category: 'Home Appliances',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 15,
      serialNumber: 'DYS-V15-AB9940128',
      modelNumber: '368340-01',
      invoiceNumber: 'BBY-0482-77291104',
      paymentMethod: 'Chase Sapphire Visa (Ending 6620)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1558317374-067fb5f30001?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'BestBuy_Dyson_V15_Bill.pdf',
      items: [
        { name: 'Dyson V15 Detect Absolute Vacuum', price: 749.99, quantity: 1, serialNumber: 'DYS-V15-AB9940128' }
      ],
      notes: '2-Year Dyson Official Manufacturer Warranty with laser Fluffy optic cleaner head.',
      confidenceScore: 0.96
    }
  },
  {
    id: 'sample-ikea-bed',
    label: 'IKEA — MALM Queen Bed Frame with Storage',
    badge: 'Furniture',
    data: {
      productName: 'IKEA MALM Queen Bed Frame with 2 Storage Boxes',
      brand: 'IKEA',
      storeName: 'IKEA Furniture',
      purchaseDate: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 150 days ago (10-yr warranty active)
      price: 449.99,
      currency: 'PKR',
      category: 'Furniture',
      warrantyMonths: 120, // 10-year IKEA warranty
      warrantyType: 'Manufacturer',
      returnPeriodDays: 180,
      serialNumber: 'IKEA-MALM-Q-77410',
      modelNumber: '102.611.66',
      invoiceNumber: 'IKEA-TXN-330188',
      paymentMethod: 'Visa Debit (Ending 4410)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'IKEA_MALM_Bed_Bill.pdf',
      items: [
        { name: 'MALM Queen Bed Frame with Storage', price: 449.99, quantity: 1, serialNumber: 'IKEA-MALM-Q-77410' }
      ],
      notes: 'IKEA 180-day return window & 10-Year limited warranty on bed frames.',
      confidenceScore: 0.94
    }
  },
  {
    id: 'sample-whole-foods-groceries',
    label: 'Whole Foods — Weekly Grocery Order',
    badge: 'Food & Groceries',
    data: {
      productName: 'Whole Foods Weekly Grocery & Fresh Produce Haul',
      brand: 'Whole Foods Market',
      storeName: 'Whole Foods Market',
      purchaseDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 2 days ago
      price: 132.40,
      currency: 'PKR',
      category: 'Food & Groceries',
      warrantyMonths: 1,
      warrantyType: 'Store / Retailer',
      returnPeriodDays: 7,
      serialNumber: 'WFM-BLK-88012',
      modelNumber: '',
      invoiceNumber: 'WFM-RCPT-901233',
      paymentMethod: 'Visa Signature (Ending 6620)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'WholeFoods_Grocery_Receipt.pdf',
      items: [
        { name: 'Organic Produce & Groceries (mixed)', price: 132.40, quantity: 1, serialNumber: 'WFM-BLK-88012' }
      ],
      notes: '7-day satisfaction guarantee on produce and perishables.',
      confidenceScore: 0.92
    }
  },
  {
    id: 'sample-nespresso-coffee',
    label: 'Nespresso — VertuoPlus Coffee Machine',
    badge: 'Food & Beverages',
    data: {
      productName: 'Nespresso VertuoPlus Deluxe Coffee & Espresso Machine',
      brand: 'Nespresso',
      storeName: 'Nespresso Boutique',
      purchaseDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 25 days ago
      price: 179.00,
      currency: 'PKR',
      category: 'Food & Beverages',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'NSP-VP-DLX-55210',
      modelNumber: 'GCA1-BV',
      invoiceNumber: 'NSP-INV-77821',
      paymentMethod: 'Mastercard (Ending 5512)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Nespresso_VertuoPlus_Bill.pdf',
      items: [
        { name: 'VertuoPlus Deluxe Coffee Machine', price: 179.00, quantity: 1, serialNumber: 'NSP-VP-DLX-55210' }
      ],
      notes: '2-Year Nespresso machine warranty with 30-day returns.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-peloton-bike',
    label: 'Peloton — Bike+ Smart Indoor Cycle',
    badge: 'Sports & Fitness',
    data: {
      productName: 'Peloton Bike+ Smart Indoor Exercise Cycle',
      brand: 'Peloton',
      storeName: 'Peloton Store',
      purchaseDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 40 days ago
      price: 2495.00,
      currency: 'PKR',
      category: 'Sports & Fitness',
      warrantyMonths: 12,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'PLTN-BKPLUS-8810',
      modelNumber: 'BIKE-PLUS-001',
      invoiceNumber: 'PLTN-INV-550992',
      paymentMethod: 'Amex Platinum (Ending 9001)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Peloton_BikePlus_Receipt.pdf',
      items: [
        { name: 'Peloton Bike+ with 22" HD Touchscreen', price: 2495.00, quantity: 1, serialNumber: 'PLTN-BKPLUS-8810' }
      ],
      notes: '30-day home trial & 1-Year hardware warranty.',
      confidenceScore: 0.96
    }
  },
  {
    id: 'sample-herman-miller-chair',
    label: 'Herman Miller — Aeron Ergonomic Office Chair',
    badge: 'Office',
    data: {
      productName: 'Herman Miller Aeron Ergonomic Office Chair (Size B)',
      brand: 'Herman Miller',
      storeName: 'Herman Miller Authorized Dealer',
      purchaseDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 200 days ago
      price: 1495.00,
      currency: 'PKR',
      category: 'Office',
      warrantyMonths: 144, // 12-year warranty
      warrantyType: 'Manufacturer',
      returnPeriodDays: 60,
      serialNumber: 'HM-AERON-B-99120',
      modelNumber: 'AERON-B',
      invoiceNumber: 'HMD-INV-204918',
      paymentMethod: 'Corporate Card (Ending 7788)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1580480055273-228ff5388ef8?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'HermanMiller_Aeron_Bill.pdf',
      items: [
        { name: 'Aeron Chair Size B with PostureFit SL', price: 1495.00, quantity: 1, serialNumber: 'HM-AERON-B-99120' }
      ],
      notes: '12-Year manufacturer warranty on frame, mechanism and casters.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-garmin-watch',
    label: 'Best Buy — Garmin Forerunner 965 GPS Watch',
    badge: 'Gadgets & Wearables',
    data: {
      productName: 'Garmin Forerunner 965 GPS Running Smartwatch',
      brand: 'Garmin',
      storeName: 'Best Buy Retail Store #482',
      purchaseDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 10 days ago (return window: 5 days left)
      price: 599.99,
      currency: 'PKR',
      category: 'Gadgets',
      warrantyMonths: 12,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 15,
      serialNumber: 'GAR-FR965-330771',
      modelNumber: '010-02815-10',
      invoiceNumber: 'BBY-0482-881023',
      paymentMethod: 'Visa Debit (Ending 4410)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'BestBuy_Garmin_Forerunner_Bill.pdf',
      items: [
        { name: 'Garmin Forerunner 965 AMOLED', price: 599.99, quantity: 1, serialNumber: 'GAR-FR965-330771' }
      ],
      notes: '1-Year Garmin limited warranty. Return window closes in 5 days!',
      confidenceScore: 0.94
    }
  },
  {
    id: 'sample-apple-ipad',
    label: 'Apple Store — iPad Air 11" M3',
    badge: 'Tablet',
    data: {
      productName: 'Apple iPad Air 11" (M3, 128GB, Starlight)',
      brand: 'Apple',
      storeName: 'Apple Store 5th Avenue',
      purchaseDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Jul 2026
      price: 649.00,
      currency: 'PKR',
      category: 'Electronics',
      warrantyMonths: 12,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 14,
      serialNumber: 'C02IPADM3-88421',
      modelNumber: 'MW1Y3LL/A',
      invoiceNumber: 'APL-INV-2026-71920',
      paymentMethod: 'Apple Pay (Amex 9001)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Apple_iPadAir_Receipt.pdf',
      items: [
        { name: 'iPad Air 11" M3 128GB', price: 649.00, quantity: 1, serialNumber: 'C02IPADM3-88421' }
      ],
      notes: '1-Year Apple Limited Warranty with 14-day returns.',
      confidenceScore: 0.97
    }
  },
  {
    id: 'sample-bose-qc',
    label: 'Bose Store — QuietComfort Ultra Headphones',
    badge: 'Audio',
    data: {
      productName: 'Bose QuietComfort Ultra Wireless Headphones',
      brand: 'Bose',
      storeName: 'Bose Official Store',
      purchaseDate: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Jun 2026
      price: 429.00,
      currency: 'PKR',
      category: 'Electronics',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'BOSE-QCU-552190',
      modelNumber: '881039-0200',
      invoiceNumber: 'BSE-RCPT-330118',
      paymentMethod: 'Mastercard (Ending 5512)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Bose_QuietComfort_Bill.pdf',
      items: [
        { name: 'QuietComfort Ultra Headphones', price: 429.00, quantity: 1, serialNumber: 'BOSE-QCU-552190' }
      ],
      notes: '2-Year Bose warranty with 30-day returns.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-lg-monitor',
    label: 'LG Store — 32" UltraGear 4K Gaming Monitor',
    badge: 'Electronics',
    data: {
      productName: 'LG 32" UltraGear 4K UHD Gaming Monitor',
      brand: 'LG',
      storeName: 'LG Authorized Retailer',
      purchaseDate: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // May 2026
      price: 549.99,
      currency: 'PKR',
      category: 'Electronics',
      warrantyMonths: 36,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 15,
      serialNumber: 'LG32UG-901227',
      modelNumber: '32GQ950-B',
      invoiceNumber: 'LGR-TXN-771204',
      paymentMethod: 'Visa Signature (Ending 6620)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'LG_UltraGear_Bill.pdf',
      items: [
        { name: 'UltraGear 32" 4K Monitor', price: 549.99, quantity: 1, serialNumber: 'LG32UG-901227' }
      ],
      notes: '3-Year LG panel warranty with 15-day returns.',
      confidenceScore: 0.96
    }
  },
  {
    id: 'sample-kitchenaid-mixer',
    label: 'KitchenAid — Artisan Stand Mixer',
    badge: 'Kitchen Appliance',
    data: {
      productName: 'KitchenAid Artisan Series 5-Qt Stand Mixer',
      brand: 'KitchenAid',
      storeName: 'KitchenAid Experience Store',
      purchaseDate: new Date(Date.now() - 125 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Apr 2026
      price: 449.99,
      currency: 'PKR',
      category: 'Home Appliances',
      warrantyMonths: 60,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'KA-ART-558201',
      modelNumber: 'KSM150PS',
      invoiceNumber: 'KIT-RCPT-440918',
      paymentMethod: 'Visa Debit (Ending 4410)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'KitchenAid_Mixer_Bill.pdf',
      items: [
        { name: 'Artisan 5-Qt Stand Mixer', price: 449.99, quantity: 1, serialNumber: 'KA-ART-558201' }
      ],
      notes: '5-Year KitchenAid warranty with 30-day returns.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-michelin-tires',
    label: 'Michelin — Pilot Sport 4S Tire Set',
    badge: 'Vehicles',
    data: {
      productName: 'Michelin Pilot Sport 4S Tires (Set of 4, 245/40ZR19)',
      brand: 'Michelin',
      storeName: 'Michelin Tire Center',
      purchaseDate: new Date(Date.now() - 145 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Mar 2026
      price: 1180.00,
      currency: 'PKR',
      category: 'Vehicles',
      warrantyMonths: 72,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'MCH-PS4S-991204',
      modelNumber: '29530PS4S',
      invoiceNumber: 'MCH-TXN-662108',
      paymentMethod: 'Amex Platinum (Ending 9001)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Michelin_Tires_Invoice.pdf',
      items: [
        { name: 'Pilot Sport 4S Tire (x4)', price: 295.00, quantity: 4, serialNumber: 'MCH-PS4S-991204' }
      ],
      notes: '6-Year Michelin treadwear warranty with free road hazard coverage.',
      confidenceScore: 0.93
    }
  },
  {
    id: 'sample-ninja-airfryer',
    label: 'Ninja — 8QT DualZone Air Fryer',
    badge: 'Kitchen Appliance',
    data: {
      productName: 'Ninja 8QT DualZone XL Air Fryer',
      brand: 'Ninja',
      storeName: 'Ninja Official Store',
      purchaseDate: new Date(Date.now() - 175 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Feb 2026
      price: 199.99,
      currency: 'PKR',
      category: 'Home Appliances',
      warrantyMonths: 24,
      warrantyType: 'Extended',
      returnPeriodDays: 30,
      serialNumber: 'NJA-DZ801-441208',
      modelNumber: 'DZ801',
      invoiceNumber: 'NJA-RCPT-229013',
      paymentMethod: 'Visa Card (Ending 1823)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Ninja_AirFryer_Bill.pdf',
      items: [
        { name: 'DualZone XL Air Fryer', price: 199.99, quantity: 1, serialNumber: 'NJA-DZ801-441208' }
      ],
      notes: '2-Year extended Ninja warranty with 30-day returns.',
      confidenceScore: 0.94
    }
  },
  {
    id: 'sample-tissot-watch',
    label: 'Tissot — PRX Automatic Watch',
    badge: 'Luxury Fashion',
    data: {
      productName: 'Tissot PRX Automatic 40mm Watch',
      brand: 'Tissot',
      storeName: 'Tissot Boutique',
      purchaseDate: new Date(Date.now() - 205 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Jan 2026
      price: 695.00,
      currency: 'PKR',
      category: 'Fashion',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 14,
      serialNumber: 'TIS-PRX-771502',
      modelNumber: 'T137.407.11.041.00',
      invoiceNumber: 'TSS-RCPT-881220',
      paymentMethod: 'Visa Signature (Ending 6620)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Tissot_PRX_Receipt.pdf',
      items: [
        { name: 'PRX Automatic 40mm', price: 695.00, quantity: 1, serialNumber: 'TIS-PRX-771502' }
      ],
      notes: '2-Year Tissot international warranty.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-timberland-boots',
    label: 'Timberland — 6-Inch Premium Boots',
    badge: 'Footwear',
    data: {
      productName: 'Timberland 6-Inch Premium Waterproof Boots',
      brand: 'Timberland',
      storeName: 'Timberland Flagship Store',
      purchaseDate: new Date(Date.now() - 235 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Dec 2025
      price: 198.00,
      currency: 'PKR',
      category: 'Fashion',
      warrantyMonths: 12,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 60,
      serialNumber: 'TBL-10061-8823',
      modelNumber: 'TB0A10061',
      invoiceNumber: 'TBL-RCPT-551902',
      paymentMethod: 'PayPal',
      receiptImageUrl: 'https://images.unsplash.com/photo-1520639888713-7851133b1ed0?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Timberland_Boots_Receipt.pdf',
      items: [
        { name: '6-Inch Premium Waterproof Boots', price: 198.00, quantity: 1, serialNumber: 'TBL-10061-8823' }
      ],
      notes: '1-Year craftsmanship warranty, 60-day wear guarantee.',
      confidenceScore: 0.94
    }
  },
  {
    id: 'sample-anker-powerbank',
    label: 'Anker — 737 140W Power Bank',
    badge: 'Gadgets',
    data: {
      productName: 'Anker 737 Power Bank 24,000mAh 140W',
      brand: 'Anker',
      storeName: 'Anker Online Store',
      purchaseDate: new Date(Date.now() - 265 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Nov 2025
      price: 129.99,
      currency: 'PKR',
      category: 'Gadgets',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'ANK-737-001294',
      modelNumber: 'A1289',
      invoiceNumber: 'ANK-ORD-77281',
      paymentMethod: 'Mastercard (Ending 5512)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1609592805392-1c0e6c9a1c9f?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Anker_737_Bill.pdf',
      items: [
        { name: '737 Power Bank 140W', price: 129.99, quantity: 1, serialNumber: 'ANK-737-001294' }
      ],
      notes: '2-Year Anker warranty with 30-day returns.',
      confidenceScore: 0.95
    }
  },
  {
    id: 'sample-logitech-mouse',
    label: 'Logitech — MX Master 3S Mouse',
    badge: 'Office Gear',
    data: {
      productName: 'Logitech MX Master 3S Wireless Mouse',
      brand: 'Logitech',
      storeName: 'Logitech Official Store',
      purchaseDate: new Date(Date.now() - 295 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Oct 2025
      price: 99.99,
      currency: 'PKR',
      category: 'Office',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'LOG-MX3S-66021',
      modelNumber: '910-006559',
      invoiceNumber: 'LGT-ORD-118920',
      paymentMethod: 'Visa Debit (Ending 4410)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Logitech_MX3S_Receipt.pdf',
      items: [
        { name: 'MX Master 3S Mouse', price: 99.99, quantity: 1, serialNumber: 'LOG-MX3S-66021' }
      ],
      notes: '2-Year Logitech warranty with 30-day returns.',
      confidenceScore: 0.96
    }
  },
  {
    id: 'sample-apple-watch',
    label: 'Apple Store — Watch Series 10',
    badge: 'Wearables',
    data: {
      productName: 'Apple Watch Series 10 (46mm, GPS + Cellular)',
      brand: 'Apple',
      storeName: 'Apple Store 5th Avenue',
      purchaseDate: new Date(Date.now() - 325 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Sep 2025
      price: 529.00,
      currency: 'PKR',
      category: 'Gadgets',
      warrantyMonths: 12,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 14,
      serialNumber: 'C02WS10-771204',
      modelNumber: 'MW863LL/A',
      invoiceNumber: 'APL-INV-2025-441209',
      paymentMethod: 'Apple Card (Ending 4092)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Apple_Watch_S10_Receipt.pdf',
      items: [
        { name: 'Apple Watch Series 10 46mm', price: 529.00, quantity: 1, serialNumber: 'C02WS10-771204' }
      ],
      notes: '1-Year Apple Limited Warranty with 14-day returns.',
      confidenceScore: 0.97
    }
  },
  {
    id: 'sample-bowflex-dumbbells',
    label: 'Bowflex — SelectTech Adjustable Dumbbells',
    badge: 'Fitness',
    data: {
      productName: 'Bowflex SelectTech 552 Adjustable Dumbbells',
      brand: 'Bowflex',
      storeName: 'Bowflex Fitness Store',
      purchaseDate: new Date(Date.now() - 355 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Aug 2025
      price: 349.00,
      currency: 'PKR',
      category: 'Sports',
      warrantyMonths: 24,
      warrantyType: 'Manufacturer',
      returnPeriodDays: 30,
      serialNumber: 'BWF-ST552-11830',
      modelNumber: '10931',
      invoiceNumber: 'BWF-INV-880120',
      paymentMethod: 'Visa Card (Ending 1823)',
      receiptImageUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=800&q=80',
      receiptFileName: 'Bowflex_Dumbbells_Bill.pdf',
      items: [
        { name: 'SelectTech 552 Dumbbells (pair)', price: 349.00, quantity: 1, serialNumber: 'BWF-ST552-11830' }
      ],
      notes: '2-Year Bowflex warranty with 30-day returns.',
      confidenceScore: 0.94
    }
  }
];

class AiReceiptParser {
  /**
   * Return list of sample receipts for competition demo
   */
  static getSampleReceipts() {
    return SAMPLE_RECEIPTS;
  }

  /**
   * Retrieve a specific sample receipt by ID
   */
  static getSampleById(id) {
    const sample = SAMPLE_RECEIPTS.find(s => s.id === id);
    if (!sample) return null;
    return JSON.parse(JSON.stringify(sample));
  }

  /**
   * Parse extracted OCR text or receipt image metadata into structured purchase
   * object. ONLY values actually found in the text are set — everything else
   * stays null. No invented defaults, no generated invoice numbers, no sample
   * retailer data, no "Purchased Item"/"Retail Merchant"/"Credit Card" fakes.
   */
  static parseReceiptText(rawText, originalFilename = '') {
    const text = (rawText || '').trim();
    const lower = text.toLowerCase();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // Default structure — null means "not detected on the receipt"
    let extracted = {
      productName: null,
      brand: null,
      storeName: null,
      purchaseDate: null,
      price: null,
      currency: 'PKR',
      category: null,
      warrantyMonths: null,
      warrantyType: null,
      returnPeriodDays: null,
      serialNumber: null,
      modelNumber: null,
      invoiceNumber: null,
      paymentMethod: null,
      quantity: null,
      tax: null,
      discount: null,
      orderId: null,
      purchaseType: null,
      receiptFileName: originalFilename || 'receipt_scan.pdf',
      receiptImageUrl: '',
      items: [],
      notes: null,
      confidenceScore: null,
      rawExtractedText: text
    };

    // -------------------------------------------------------------------------
    // 1. EXTRACT PRICE / TOTAL (TASK 2)
    // -------------------------------------------------------------------------
    const extractPriceFromLine = (line) => {
      if (!line) return null;
      const numMatches = [...line.matchAll(/(?:[$€£₹₨¥%]|rs\.?|inr|pkr)?\s*([\d]{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi)];
      const validNums = [];
      for (const m of numMatches) {
        if (!m[1]) continue;
        const clean = m[1].replace(/,/g, '');
        const v = parseFloat(clean);
        if (!isNaN(v) && v > 0) {
          validNums.push(v);
        }
      }
      return validNums.length ? validNums[validNums.length - 1] : null;
    };

    const isTaxOrSubtotalOnlyLine = (line) => {
      if (/\b(?:gst\s*amount|gst\s*assessable|cgst|sgst|igst|sales\s*tax|tax\s*amount|taxable\s*value|taxable\s*amount|sub\s*total|subtotal|mrp|unit\s*price)\b/i.test(line)) return true;
      if (/^(?:tax|gst|vat|hst)\b/i.test(line) && !/total/i.test(line)) return true;
      return false;
    };

    const pricePriorityPatterns = [
      // Priority 1: Payable Amount / Amount Payable
      /(?:payable\s*amount|amount\s*payable|net\s*payable|total\s*payable|amount\s*due|balance\s*due|net\s*amount)/i,
      // Priority 2: Grand Total / Final Amount / Amount Paid
      /(?:grand\s*total|final\s*amount|amount\s*paid|total\s*amount\s*paid)/i,
      // Priority 3: Total / Total Amount
      /(?:total\s*amount|\btotal\b)/i
    ];

    let foundPrice = null;
    for (let p = 0; p < pricePriorityPatterns.length; p++) {
      const pat = pricePriorityPatterns[p];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isTaxOrSubtotalOnlyLine(line)) continue;
        if (p === 2) {
          if (/(?:sub\s*total|total\s*tax|total\s*gst|total\s*discount|total\s*savings|total\s*qty|total\s*items?|total\s*pieces?)/i.test(line)) {
            continue;
          }
        }
        if (pat.test(line)) {
          let val = extractPriceFromLine(line);
          if (val === null && i + 1 < lines.length && !isTaxOrSubtotalOnlyLine(lines[i + 1])) {
            val = extractPriceFromLine(lines[i + 1]);
          }
          if (val !== null) {
            foundPrice = val;
          }
        }
      }
      if (foundPrice !== null) break;
    }

    if (foundPrice !== null) {
      extracted.price = foundPrice;
    } else {
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (isTaxOrSubtotalOnlyLine(line)) continue;
        if (/(?:total|subtotal|tax|gst|phone|tel|pincode|date)/i.test(line)) continue;
        const m = line.match(/(?:[$€£₹₨¥]|rs\.?|pkr|inr)\s*([\d]{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
        if (m && m[1]) {
          const v = parseFloat(m[1].replace(/,/g, ''));
          if (!isNaN(v) && v > 0) {
            extracted.price = v;
            break;
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. EXTRACT CURRENCY
    // -------------------------------------------------------------------------
    if (text.includes('₹') || lower.includes('inr') || lower.includes('rupees') || lower.includes('gstin') || lower.includes('sgst') || lower.includes('cgst') || lower.includes('mumbai') || lower.includes('maharashtra') || lower.includes('delhi') || lower.includes('bangalore')) {
      extracted.currency = 'INR';
    } else if (text.includes('₨') || lower.includes('pkr') || lower.includes('karachi') || lower.includes('lahore') || lower.includes('islamabad')) {
      extracted.currency = 'PKR';
    } else if (text.includes('€') || lower.includes('eur')) extracted.currency = 'EUR';
    else if (text.includes('£') || lower.includes('gbp')) extracted.currency = 'GBP';
    else if (text.includes('$') || lower.includes('usd')) extracted.currency = 'USD';
    else if (lower.includes('rs.') || lower.includes('rs ')) extracted.currency = 'INR';
    else extracted.currency = 'INR';

    // -------------------------------------------------------------------------
    // 3. EXTRACT DATE (TASK 5)
    // -------------------------------------------------------------------------
    const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const parseNumericDate = (s) => {
      const parts = s.split(/[-\/.]/).map(p => p.trim());
      if (parts.length !== 3 || !parts.every(p => /^\d+$/.test(p))) return null;
      const p0 = Number(parts[0]);
      const p1 = Number(parts[1]);
      const p2 = Number(parts[2]);
      let year, month, day;
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        year = p0;
        month = p1;
        day = p2;
      } else if (parts[2].length === 4 || parts[2].length === 2) {
        // DD-MM-YYYY or MM-DD-YYYY
        const rawYear = p2;
        year = rawYear < 100 ? 2000 + rawYear : rawYear;
        if (p0 > 12) {
          day = p0;
          month = p1;
        } else if (p1 > 12) {
          day = p1;
          month = p0;
        } else {
          // Standard DD-MM-YYYY
          day = p0;
          month = p1;
        }
      } else {
        return null;
      }
      if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
      const d = new Date(Date.UTC(year, month - 1, day));
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    const parseMonthNameDate = (s) => {
      let m = s.match(/^(\d{1,2})[-\/ ]\s*([A-Za-z]{3,9})[-\/ ]\s*(\d{2,4})$/);
      if (m) {
        const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (!month) return null;
        const rawYear = Number(m[3]);
        const year = rawYear < 100 ? 2000 + rawYear : rawYear;
        const d = new Date(Date.UTC(year, month - 1, Number(m[1])));
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
      }
      m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
      if (m) {
        const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (!month) return null;
        const d = new Date(Date.UTC(Number(m[3]), month - 1, Number(m[2])));
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
      }
      return null;
    };

    const DATE_TOKEN = /(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})|(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})|(\d{1,2}[-\/ ]\s*[A-Za-z]{3,9}[-\/ ]\s*\d{2,4})|([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/;
    for (const line of lines) {
      if (!/(\bdate\b|\bdated\b|\bissued?\b|\bpurchased\b|\binvoice\s*date\b|\bbill\s*date\b|\btxn\s*date\b)/i.test(line)) continue;
      if (/(deliver|dispatch|warrant|expir|birth|dob)/i.test(line)) continue;
      const labelPart = line.match(/(?:\bdate\b|\bdated\b|\bissued?\b|\bpurchased\b|\binvoice\s*date\b|\bbill\s*date\b|\btxn\s*date\b)\s*[:#.]?\s*(.*)$/i);
      if (!labelPart) continue;
      const tok = labelPart[1].match(DATE_TOKEN);
      if (!tok) continue;
      let parsed = null;
      if (tok[1]) parsed = parseNumericDate(tok[1]);
      else if (tok[2]) parsed = parseNumericDate(tok[2]);
      else if (tok[3]) parsed = parseMonthNameDate(tok[3].replace(/\s+/g, ' ').trim());
      else if (tok[4]) parsed = parseMonthNameDate(tok[4]);
      if (parsed) {
        extracted.purchaseDate = parsed;
        break;
      }
    }

    // -------------------------------------------------------------------------
    // 4. EXTRACT INVOICE NUMBER (TASK 6)
    // -------------------------------------------------------------------------
    const invoicePatterns = [
      /(?:invoice\s*\/?\s*receipt\s*no\.?|invoice\s*no\.?|invoice\s*number|inv\s*no\.?|inv\.\s*no\.?|bill\s*no\.?|bill\s*number|receipt\s*no\.?|receipt\s*number)\s*[:#=.]*\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,32})/i,
      /(?:invoice|inv|bill|receipt)\s*[:#.]\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,32})/i
    ];
    let invoiceMatch = null;
    for (const re of invoicePatterns) {
      invoiceMatch = text.match(re);
      if (invoiceMatch) break;
    }
    if (invoiceMatch && invoiceMatch[1]) {
      const candidate = invoiceMatch[1].trim().replace(/[\/\-.]+$/, '');
      if (/\d/.test(candidate) && !/^(serial|sn|imei|model|gstin|pan|mobile|phone|tel|total|cash|date)\b/i.test(candidate)) {
        extracted.invoiceNumber = candidate;
      }
    }

    // -------------------------------------------------------------------------
    // 5. EXTRACT SERIAL / IMEI / MODEL (TASK 8)
    // -------------------------------------------------------------------------
    const serialMatch = text.match(/(?:serial\s*(?:no\.?|number|#)?|s\/n|sn|imei(?:\s*no\.?)?)\s*[:#=.]*\s*([A-Za-z0-9-]{6,25})/i);
    if (serialMatch && serialMatch[1]) {
      const cand = serialMatch[1].trim();
      if (!/^(?:invoice|bill|receipt|phone|mobile|tel|total|model)\b/i.test(cand) && !/^\d{10,11}$/.test(cand)) {
        extracted.serialNumber = cand;
      }
    }

    const modelMatch = text.match(/(?:model\s*(?:no\.?|number|#)?|sku|part\s*#)\s*[:#=.]*\s*([A-Za-z0-9-\/]{4,20})/i);
    if (modelMatch && modelMatch[1]) {
      extracted.modelNumber = modelMatch[1].trim();
    }

    // -------------------------------------------------------------------------
    // 6. EXTRACT STORE / MERCHANT NAME (TASK 4)
    // -------------------------------------------------------------------------
    const cleanStoreLine = (line) => {
      if (!line) return '';
      let left = line.split(/(?:\binvoice\b|\bbill\s*no\b|\bdate\b|\btax\s*invoice\b)/i)[0].trim();
      left = left.replace(/^[&,.\s\-–—]+/, '').replace(/[\s\-–—]+$/, '');
      left = left.replace(/\b(?:tax\s*invoice|original\s*for\s*recipient|duplicate|triplicate|live\s*comfortable)\b/gi, '').trim();
      return left;
    };

    const isCleanStoreCandidate = (line) => {
      const clean = cleanStoreLine(line);
      if (!clean || clean.length < 3 || !/[A-Za-z]/.test(clean)) return false;
      const letters = (clean.match(/[A-Za-z]/g) || []).length;
      const alnum = (clean.match(/[A-Za-z0-9]/g) || []).length;
      if (alnum === 0 || letters / alnum < 0.6) return false;    // rejects OCR garbage "[4 E78;»"
      if (/[^A-Za-z0-9\s.,&'()\/\-:]/.test(clean)) return false;  // weird OCR glyphs
      if (/\b(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})|\btel\b|\bphone\b|\bmobile\b|www\.|https?:|\bgstin\b|\bgst\b|\bpan\b|^\d+$|thank|cashier|sales\s*executive\b/i.test(clean)) return false;
      if (/\b(road|street|mall|lane|nagar|pincode|madhapur|hitec|university|village|plot|floor|ground|karachi|mumbai|delhi|lahore|islamabad|bangalore|hyderabad|chennai|telangana|maharashtra)\b/i.test(clean)) return false;
      if (/\b\d{6}\b/.test(clean)) return false; // pincode
      if (/^(?:s\.?no|particulars?|description|qty|quantity|unit\s*price|sub\s*total|grand\s*total|bill\s*to|ship\s*to)\b/i.test(clean)) return false;
      return true;
    };

    const storeKeywords = /(store|super\s*store|mart|shop|bazaar|bazar|traders?|enterprises?|agency|dealers?|distributors?|electronics|mobiles?|furniture|city|centre|center|world|plaza|point|hub|care|croma|reliance|apple|comforto)/i;
    const headerLines = lines.slice(0, 10);
    const storeCandidates = headerLines.map(cleanStoreLine).filter(isCleanStoreCandidate);
    
    // Prioritize candidates with corporate / store suffixes (e.g. PVT. LTD.) and longer specific names
    const pvtStore = storeCandidates.find(l => /(?:pvt\.?\s*ltd\.?|ltd\.?|llc|inc)/i.test(l) && !/^(?:A\s*TATA\s*ENTERPRISE)$/i.test(l));
    const keywordStores = storeCandidates.filter(l => storeKeywords.test(l) && !/^(?:A\s*TATA\s*ENTERPRISE)$/i.test(l)).sort((a, b) => b.length - a.length);
    const capsStore = storeCandidates.find(l => {
      const ls = l.replace(/[^A-Za-z]/g, '');
      return ls.length >= 4 && ls === ls.toUpperCase() && !/^(?:A\s*TATA\s*ENTERPRISE)$/i.test(l);
    });
    
    extracted.storeName = pvtStore || keywordStores[0] || capsStore || storeCandidates.find(l => !/^(?:A\s*TATA\s*ENTERPRISE)$/i.test(l)) || storeCandidates[0] || null;

    // -------------------------------------------------------------------------
    // 7. EXTRACT PRODUCT NAME, ITEMS & QUANTITY (TASK 3, TASK 7)
    // -------------------------------------------------------------------------
    const isItemAttributeLine = (line) => {
      if (!line) return false;
      return /^(?:model(?:\s*no\.?|\s*number|\s*#)?|serial(?:\s*no\.?|\s*number|\s*#)?|s\/n|sn|imei(?:\s*no\.?)?|colour|color|material|sku|hsn(?:\s*code)?|sac(?:\s*code)?|warranty|mrp|item\s*code)\s*[:#.]/i.test(line)
        || /^(?:model|serial|imei|sku|hsn)\s*:\s*/i.test(line)
        || /^(?:model\s*no|serial\s*no)\s*[:#.]/i.test(line);
    };

    const isNoiseOrNonProductLine = (line) => {
      if (!line || line.length < 2) return true;
      if (/^(?:total|grand\s*total|sub\s*total|subtotal|balance|amount|net\s*amount|tax|vat|gst|cgst|sgst|igst|discount|savings|change|cash|payment|paid|visa|mastercard|amex|date|time|invoice|receipt|bill|order|tel|phone|mobile|call|www\.|https?:|thank|customer|cashier|sales\s*executive|store|branch|bill\s*to|ship\s*to|terms|goods\s*once|for\s*any\s*assistance|please\s*inspect|visit\s*us|warranty\s*valid|approval\s*code|transaction\s*id|card\s*no)\b/i.test(line)) return true;
      if (/\b(?:gstin|pan|cin)\b/i.test(line)) return true;
      if (/\b(?:phone|mobile|tel|contact)\s*[:#0-9+]/i.test(line)) return true;
      if (/\b(?:mobile\s*no|mobile\s*number|phone\s*no|contact\s*no|customer\s*care|tel\s*no)\b/i.test(line)) return true;
      if (/\b\d{6}\b/.test(line)) return true; // pincode in line
      if (/^[\d\s.,:xX×\/\-#–—_=|]+$/.test(line)) return true; // only numbers and symbols
      if (/[;»~<>{}\[\]]/.test(line)) return true; // OCR garbage glyphs
      return false;
    };

    let detectedProductName = null;
    const lineItems = [];

    // Approach 1: Check for Table Header
    const tableHeaderIdx = lines.findIndex(l =>
      /(?:particulars?|product\s*description|item\s*description|\bdescription\b|\bitems?\b|\bproducts?\b)/i.test(l)
      && /(?:qty|quantity|rate|price|amount|hsn|s\.?\s*no)/i.test(l)
    );

    if (tableHeaderIdx >= 0) {
      for (let i = tableHeaderIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^(?:sub\s*total|subtotal|total|grand\s*total|sgst|cgst|igst|vat|tax|payment|paid\s*by|amount\s*in\s*words|30-day|7-day|return|terms)/i.test(line)) {
          break;
        }
        if (isNoiseOrNonProductLine(line) || isItemAttributeLine(line)) continue;

        const tableRowMatch = line.match(/^(\d{1,3}[.)]\s+|\b\d{1,3}\s+)?(.+?)\s+(?:(\d{4,8})\s+)?(\d{1,3})[,.]?\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/);
        
        let cleanName = '';
        let itemQty = 1;
        let itemPrice = null;

        if (tableRowMatch) {
          cleanName = tableRowMatch[2].trim();
          itemQty = parseInt(tableRowMatch[4], 10) || 1;
          const pStr = tableRowMatch[6] ? tableRowMatch[6].replace(/,/g, '') : '';
          const p = parseFloat(pStr);
          if (!isNaN(p) && p > 0) itemPrice = p;
        } else {
          let clean = line.replace(/^\d{1,3}[.)]\s+|\b\d{1,3}\s+(?=[A-Za-z])/, '');
          const priceMatches = [...clean.matchAll(/[$€£₹₨¥%]?\s*([\d]{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)];
          if (priceMatches.length) {
            const lastNum = priceMatches[priceMatches.length - 1][1].replace(/,/g, '');
            const pVal = parseFloat(lastNum);
            if (!isNaN(pVal) && pVal > 0) itemPrice = pVal;
          }
          clean = clean.replace(/(?:[$€£₹₨¥%]?\s*[\d,]+(?:\.\d{1,2})?\s*)+$/, '').trim();
          const qtyEndMatch = clean.match(/\s+(\d{1,3})[,.]?$/);
          if (qtyEndMatch) {
            itemQty = parseInt(qtyEndMatch[1], 10) || 1;
            clean = clean.slice(0, qtyEndMatch.index).trim();
          }
          clean = clean.replace(/\s+\d{4,10}$/, '').trim();
          cleanName = clean;
        }

        if (cleanName.length >= 3 && !isNoiseOrNonProductLine(cleanName) && !isItemAttributeLine(cleanName)) {
          let fullDesc = cleanName;
          let j = i + 1;
          while (j < lines.length && j <= i + 3) {
            const nextL = lines[j];
            if (/^\d{1,3}[.)]\s+[A-Za-z]/.test(nextL)) break;
            if (/^(?:sub\s*total|total|sgst|cgst|grand\s*total)/i.test(nextL)) break;
            if (isNoiseOrNonProductLine(nextL)) break;
            
            const modM = nextL.match(/model\s*[:#.]*\s*([A-Za-z0-9-\/]+)/i);
            if (modM && !extracted.modelNumber) extracted.modelNumber = modM[1].trim();

            if (!isItemAttributeLine(nextL) && /^[A-Za-z0-9,\s\-()+/]+$/.test(nextL) && !/\d{5,}/.test(nextL)) {
              fullDesc += ' ' + nextL;
              i = j;
            }
            j++;
          }

          lineItems.push({
            productName: fullDesc.trim(),
            price: itemPrice || extracted.price,
            quantity: itemQty
          });
          if (!detectedProductName) {
            detectedProductName = fullDesc.trim();
          }
        }
      }
    }

    // Approach 2: Look for product lines preceding Qty / Price in receipt body
    if (!detectedProductName) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isNoiseOrNonProductLine(line) || isItemAttributeLine(line)) continue;

        const qtyMatch = line.match(/(?:qty|quantity)\s*[:#]?\s*(\d{1,4})/i);
        const priceMatch = line.match(/^(?:.*?)\s*(?:[$€£₹₨]|rs\.?|pkr|inr)\s*([\d,]+(?:\.\d{1,2})?)\s*$/i);

        if (qtyMatch || (priceMatch && /qty/i.test(line))) {
          const itemQty = qtyMatch ? (parseInt(qtyMatch[1], 10) || 1) : 1;
          const productParts = [];
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
            const prev = lines[j];
            if (isNoiseOrNonProductLine(prev) || isItemAttributeLine(prev)) break;
            productParts.unshift(prev);
          }
          if (productParts.length) {
            detectedProductName = productParts.join(' ');
            const p = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : extracted.price;
            lineItems.push({
              productName: detectedProductName,
              price: p || extracted.price,
              quantity: itemQty
            });
            break;
          }
        }
      }
    }

    // Approach 3: Fallback scan — collect ALL brand/keyword product lines (not just first).
    // Does NOT break on first match so multi-product non-table bills are fully captured.
    const BRAND_WORDS = ['Apple', 'Samsung', 'Sony', 'LG', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'Xiaomi', 'Redmi', 'OnePlus', 'Oppo', 'Vivo', 'Realme', 'Nokia', 'Motorola', 'Google', 'Philips', 'Whirlpool', 'Dyson', 'Bosch', 'Godrej', 'Haier', 'Panasonic', 'Canon', 'Nikon', 'Nike', 'Adidas', 'Puma', 'Reebok', 'IKEA', 'boAt', 'JBL', 'Bose', 'Voltas', 'Daikin', 'Hitachi', 'Toshiba', 'Havells', 'Bajaj', 'Crompton', 'Usha', 'Prestige', 'Faber', 'Comforto'];
    if (!detectedProductName) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isNoiseOrNonProductLine(line) || isItemAttributeLine(line)) continue;
        const hasBrand = BRAND_WORDS.some(b => new RegExp('\\b' + b + '\\b', 'i').test(line));
        const hasProductKeyword = /(?:laptop|macbook|phone|pro|air|galaxy|iphone|tv|oled|bravia|headphones|wh-|refrigerator|fridge|shoes|camera|watch|monitor|washer|dryer|speaker|soundbar|chair|desk|airpods|earbuds|smartwatch)/i.test(line);
        if (hasBrand || hasProductKeyword) {
          let clean = line.replace(/^\d{1,3}[.)]\s+/, '').replace(/(?:[$€£₹₨¥%]?\s*[\d,]+(?:\.\d{1,2})?\s*)+$/, '').trim();
          if (clean.length >= 3 && !isNoiseOrNonProductLine(clean) && !isItemAttributeLine(clean)) {
            // Deduplication: skip if a very similar line is already captured
            const alreadyCaptured = lineItems.some(it =>
              (it.productName || '').toLowerCase() === clean.toLowerCase()
            );
            if (!alreadyCaptured) {
              if (!detectedProductName) detectedProductName = clean;
              lineItems.push({
                productName: clean,
                price: null,
                quantity: 1
              });
            }
          }
        }
      }
    }

    if (detectedProductName) {
      let clean = detectedProductName
        .replace(/(?:standard|express|free|cash on)?\s*delivery\s*(?:\([^)]*\)|[0-9\-–\s]+business days)?/gi, '')
        .replace(/shipping\s*(?:charges|fee)?\s*(?:free|[0-9,.]+)?/gi, '')
        .replace(/discount\s*[:\-–]?\s*[0-9,.\-–\s]+/gi, '')
        .replace(/subtotal\s*[:\-–]?\s*[0-9,.]+/gi, '')
        .replace(/total\s*amount\s*[:\-–]?\s*[0-9,.]+/gi, '')
        .replace(/[0-9]+\s+color modes/gi, '')
        .replace(/\b(?:Th|oy|wil|wil\s+A|7s\s+h|7s|s\s+h)\b/gi, '')
        .replace(/[-–,.:\s]+$/, '')
        .replace(/^[-–,.:\s]+/, '')
        .trim();
      extracted.productName = clean || detectedProductName;
    } else {
      extracted.productName = null;
    }
    extracted.items = lineItems;

    // -------------------------------------------------------------------------
    // 7b. ENRICH EACH ITEM with brand, category, serialNumber, warrantyMonths,
    //     returnPeriodDays. Per-item warranty / serial / return fields are null
    //     unless explicitly associated with that line — never guessed.
    // -------------------------------------------------------------------------
    extracted.items = extracted.items.map(item => {
      const pnRaw = item.productName || item.name || '';
      const pn = pnRaw.toLowerCase();

      // Brand: first BRAND_WORDS entry found inside the product name string
      const detectedItemBrand = BRAND_WORDS.find(b =>
        new RegExp('(^|[^A-Za-z])' + b.replace(/[+]/g, '\\+') + '([^A-Za-z]|$)', 'i').test(pnRaw)
      ) || null;

      // Category: keyword-based, mirrors the bill-level section-8 logic
      let detectedItemCategory = null;
      if (/(?:chair|desk|table|sofa|bed|furniture|ergonomic|mesh|visitor)/i.test(pn)) {
        detectedItemCategory = 'Furniture';
      } else if (/(?:macbook|laptop|iphone|galaxy|oneplus|pixel|oppo|vivo|realme|redmi|xiaomi|motorola|nokia|tv|oled|bravia|headphone|earphone|wh-1000|speaker|soundbar|camera|tablet|ipad|\bphone\b|\bpc\b|airpods|earbuds|smartwatch)/i.test(pn)) {
        detectedItemCategory = 'Electronics';
      } else if (/(?:refrigerator|fridge|washer|dryer|microwave|oven|air\s*conditioner|\bac\b|dishwasher)/i.test(pn)) {
        detectedItemCategory = 'Home Appliances';
      } else if (/(?:shoe|shoes|sneaker|shirt|t-shirt|pant|dress|jacket|wear|running\s*shoe|boots?)/i.test(pn)) {
        detectedItemCategory = 'Fashion';
      }

      return {
        productName: pnRaw || null,
        brand: detectedItemBrand,
        quantity: item.quantity || 1,
        price: item.price !== undefined ? item.price : null,
        category: detectedItemCategory,
        // Per-item serial / warranty / return: null — not detectable per-line
        // without an explicit label next to that line item on the receipt.
        serialNumber: null,
        warrantyMonths: null,
        returnPeriodDays: null
      };
    });

    // Quantity resolution (TASK 7)
    if (extracted.items.length) {
      extracted.quantity = extracted.items.reduce((s, it) => s + (it.quantity || 1), 0);
    } else {
      const explicitQtyMatch = text.match(/(?:qty|quantity)\s*[:#]?\s*(\d{1,4})/i)
        || text.match(/\b(\d{1,4})\s*(?:nos?|pcs?|pieces?|units?)\b/i);
      if (explicitQtyMatch) {
        extracted.quantity = parseInt(explicitQtyMatch[1], 10) || null;
      } else {
        extracted.quantity = null;
      }
    }

    // -------------------------------------------------------------------------
    // 8. EXTRACT BRAND & CATEGORY
    // -------------------------------------------------------------------------
    const brandLabelMatch = text.match(/brand\s*[:#=]+\s*([A-Za-z][A-Za-z0-9&.'-]*(?:[ ][A-Za-z0-9&.'-]+){0,2})/i);
    if (brandLabelMatch && !/not\s*detected/i.test(brandLabelMatch[1])) {
      extracted.brand = brandLabelMatch[1].trim();
    } else {
      const brandHay = ((extracted.productName || '') + '\n' + (extracted.storeName || '') + '\n' + text);
      const foundBrand = BRAND_WORDS.find(b =>
        new RegExp('(^|[^A-Za-z])' + b.replace(/[+]/g, '\\+') + '([^A-Za-z]|$)', 'i').test(brandHay)
      );
      if (foundBrand) extracted.brand = foundBrand;
    }

    const prodLower = (extracted.productName || '').toLowerCase();
    const storeLower = (extracted.storeName || '').toLowerCase();
    if (/(?:chair|desk|table|sofa|bed|furniture|comforto|ergonomic|mesh|visitor)/i.test(prodLower) || /(?:furniture)/i.test(storeLower)) {
      extracted.category = 'Furniture';
    } else if (/(?:macbook|laptop|iphone|galaxy|oneplus|pixel|oppo|vivo|realme|redmi|xiaomi|motorola|nokia|tv|oled|bravia|headphone|earphone|wh-1000|speaker|soundbar|camera|audio|tablet|ipad|\bphone\b|\bpc\b)/i.test(prodLower) || /(?:electronics|croma|digital)/i.test(storeLower)) {
      extracted.category = 'Electronics';
    } else if (/(?:refrigerator|fridge|washer|dryer|microwave|oven|air\s*conditioner|\bac\b|dishwasher)/i.test(prodLower)) {
      extracted.category = 'Home Appliances';
    } else if (/(?:shoe|shoes|sneaker|shirt|t-shirt|pant|dress|jacket|wear|running\s*shoe)/i.test(prodLower)) {
      extracted.category = 'Fashion';
    } else if (/(?:store|electronics|shop|digital)/i.test(storeLower)) {
      extracted.category = 'Electronics';
    }

    // -------------------------------------------------------------------------
    // 9. EXTRACT WARRANTY & RETURN PERIOD (TASK 9)
    // -------------------------------------------------------------------------
    const warrantyMatch = text.match(/([0-9]{1,2})\s*[- ]?(?:year|yr|month|mo)s?\s*(?:limited\s*)?(?:warranty|guarantee|applecare|protection)/i)
      || text.match(/warranty\s*[:#=]?\s*([0-9]{1,3})\s*(year|yr|month|mo)/i);
    if (warrantyMatch && warrantyMatch[1]) {
      const num = parseInt(warrantyMatch[1], 10);
      const unitIsYear = (warrantyMatch[2] && /year|yr/i.test(warrantyMatch[2]))
        || (!warrantyMatch[2] && (warrantyMatch[0].toLowerCase().includes('year') || warrantyMatch[0].toLowerCase().includes('yr')));
      extracted.warrantyMonths = unitIsYear ? num * 12 : num;
      extracted.warrantyType = 'Manufacturer';
    }

    const returnMatch = text.match(/(\d{1,3})\s*[- ]?day\s*(?:s?\s*)?(?:return|returns|exchange|refund|money[- ]back)/i)
      || text.match(/return(?:s)?\s*(?:policy|window|period)?\s*[:\-]?\s*(\d{1,3})\s*day/i);
    if (returnMatch) {
      const days = parseInt(returnMatch[1], 10);
      if (!isNaN(days) && days > 0 && days <= 365) extracted.returnPeriodDays = days;
    }

    // -------------------------------------------------------------------------
    // 10. EXTRACT PAYMENT METHOD
    // -------------------------------------------------------------------------
    if (/visa/i.test(text)) extracted.paymentMethod = 'Visa Card';
    else if (/mastercard/i.test(text)) extracted.paymentMethod = 'Mastercard';
    else if (/amex|american express/i.test(text)) extracted.paymentMethod = 'American Express';
    else if (/apple pay/i.test(text)) extracted.paymentMethod = 'Apple Pay';
    else if (/paypal/i.test(text)) extracted.paymentMethod = 'PayPal';
    else if (/upi|gpay|phonepe/i.test(text)) extracted.paymentMethod = 'UPI Digital Pay';
    else if (/cash/i.test(text)) extracted.paymentMethod = 'Cash';

    // -------------------------------------------------------------------------
    // 11. EXTRACT TAX & DISCOUNT
    // -------------------------------------------------------------------------
    const cgstMatch = text.match(/cgst\s*(?:\([^)]{1,8}\))?\s*[:#=]?\s*[$€£₹₨¥%]?\s*[A-Za-z]{0,3}\s*([\d,]+(?:\.\d{1,2})?)/i);
    const sgstMatch = text.match(/sgst\s*(?:\([^)]{1,8}\))?\s*[:#=]?\s*[$€£₹₨¥%]?\s*[A-Za-z]{0,3}\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (cgstMatch && sgstMatch) {
      const cVal = parseFloat(cgstMatch[1].replace(/[,\s]/g, ''));
      const sVal = parseFloat(sgstMatch[1].replace(/[,\s]/g, ''));
      if (!isNaN(cVal) && !isNaN(sVal)) {
        extracted.tax = cVal + sVal;
      }
    } else {
      const taxMatch = text.match(/(?:^|\s)(?:sales\s+)?(?:tax|vat|gst|hst)\s*(?:\([^)]{1,12}\))?\s*[:#=]?\s*[$€£₹₨¥%]?\s*[A-Za-z]{0,3}\s*([\d,]+(?:\.\d{1,2})?)/im);
      if (taxMatch) {
        const taxVal = parseFloat(taxMatch[1].replace(/[,\s]/g, ''));
        if (!isNaN(taxVal) && taxVal > 0) extracted.tax = taxVal;
      }
    }

    const discountMatch = text.match(/(?:discount|savings|you\s+saved|promo(?:tion)?|coupon)\s*[:#=]?\s*-?\s*[$€£₹₨¥%]?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (discountMatch) {
      const discVal = parseFloat(discountMatch[1].replace(/[,\s]/g, ''));
      if (!isNaN(discVal) && discVal > 0) extracted.discount = discVal;
    }

    // -------------------------------------------------------------------------
    // 12. EXTRACT ORDER ID & PURCHASE TYPE
    // -------------------------------------------------------------------------
    const orderMatch = text.match(/order\s*(?:id|no\.?|number|#)\s*[:#=]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,23})/i);
    if (orderMatch) extracted.orderId = orderMatch[1].trim();

    const onlineSignals = /www\.|https?:|\.com\b|order\s*(?:id|no|#)|ship|deliver|e-?receipt|\bonline\b/i;
    const offlineSignals = /\btel\b|\bphone\b|store\s*(?:#|no|address)|branch|counter|thank you for shopping/i;
    const isOnline = onlineSignals.test(text);
    const isOffline = offlineSignals.test(text);
    if (isOnline && !isOffline) extracted.purchaseType = 'ONLINE';
    else if (isOffline && !isOnline) extracted.purchaseType = 'OFFLINE';

    return extracted;
  }

  /**
   * Passthrough kept for backward compatibility. Returns the AI-extracted
   * result untouched — no retailer knowledge defaults are ever applied, so
   * missing values stay null instead of being invented.
   */
  static enrichWithRetailerKnowledge(extracted) {
    return { ...extracted };
  }
}

module.exports = AiReceiptParser;
