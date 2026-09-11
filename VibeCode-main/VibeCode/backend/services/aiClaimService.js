/**
 * AI Warranty Claim & Dispute Letter Generator Service
 * Automatically crafts formal, legally compliant claim letters citing invoice,
 * serial number, purchase dates, warranty terms, and consumer rights.
 */

class AiClaimService {
  /**
   * Generate formal warranty claim letter
   */
  static generateClaimLetter({
    customerName = 'Valued Customer',
    customerEmail = '',
    productName,
    brand,
    storeName,
    purchaseDate,
    price,
    currency = 'USD',
    warrantyMonths,
    warrantyExpiresAt,
    serialNumber,
    modelNumber,
    invoiceNumber,
    issueCategory = 'Hardware Defect / Operational Failure',
    issueDescription = 'Device ceased operating under normal usage conditions.',
    desiredResolution = 'Official Warranty Repair / Replacement'
  }) {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const formattedPurchaseDate = new Date(purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const formattedExpiryDate = new Date(warrantyExpiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'INR' ? '₹' : currency === 'PKR' ? '₨' : '₨';

    const subject = `URGENT: Warranty Service & Repair Claim — ${productName} (Serial: ${serialNumber || 'N/A'}, Invoice: ${invoiceNumber || 'N/A'})`;

    const letterBody = `
Date: ${today}

TO:
Customer Support & Warranty Claims Department
${brand || storeName} (${storeName})

FROM:
${customerName}
${customerEmail ? `Email: ${customerEmail}` : ''}

SUBJECT: FORMAL WARRANTY SERVICE & REMEDY CLAIM FOR ${productName.toUpperCase()}

Dear Warranty Support Team,

I am writing to formally request warranty service, authorized repair, or replacement for my ${productName}, which was purchased on ${formattedPurchaseDate} from ${storeName} for the amount of ${symbol}${price.toLocaleString('en-US', { minimumFractionDigits: 2 })} under Invoice/Receipt #${invoiceNumber || 'Refer to attached receipt'}.

1. PRODUCT & IDENTIFICATION DETAILS:
   - Product Name: ${productName}
   - Manufacturer / Brand: ${brand || 'N/A'}
   - Model Number: ${modelNumber || 'N/A'}
   - Serial / IMEI Number: ${serialNumber || 'Refer to device label'}
   - Purchase Date: ${formattedPurchaseDate}
   - Active Warranty Validity Period: ${warrantyMonths} Months (Valid until ${formattedExpiryDate})

2. NATURE OF DEFECT / FAILURE DESCRIPTION:
   - Issue Classification: ${issueCategory}
   - Detailed Description:
     "${issueDescription}"
   - Usage Conditions: The item has been operated strictly in accordance with official manufacturer instructions and has suffered no physical abuse, liquid exposure, or unauthorized modifications.

3. WARRANTY COVERAGE & LEGAL BASIS:
   As the product is within its active manufacturer warranty period (expiring ${formattedExpiryDate}), I am entitled to remedy under the manufacturer's express limited warranty terms and statutory consumer protection standards for merchantable goods.

4. REQUESTED RESOLUTION:
   In accordance with the applicable warranty terms, I respectfully request:
   - Immediate authorization of a Return Merchandise Authorization (RMA) for ${desiredResolution.toLowerCase()}.
   - Provision of prepaid shipping instructions or referral to the nearest authorized service center.

Please confirm receipt of this claim within two (2) business days and provide RMA instructions. A copy of the original purchase invoice and proof of purchase is attached.

Thank you for your prompt assistance and customer support.

Sincerely,

${customerName}
${customerEmail}
`.trim();

    return {
      subject,
      letterBody,
      timestamp: new Date().toISOString(),
      metadata: {
        productName,
        brand,
        serialNumber,
        invoiceNumber,
        warrantyExpiresAt: formattedExpiryDate,
        resolution: desiredResolution
      }
    };
  }
}

module.exports = AiClaimService;
