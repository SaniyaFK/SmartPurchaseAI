const nodemailer = require('nodemailer');

/**
 * Warranty Email Notification Service — Gmail SMTP via Nodemailer
 * Uses EMAIL_USER and EMAIL_APP_PASSWORD from backend/.env
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const EMAIL_USER = process.env.EMAIL_USER;
  const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;

  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
    console.warn('[EmailService] EMAIL_USER or EMAIL_APP_PASSWORD not set in .env — emails will not be sent.');
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_APP_PASSWORD
    }
  });

  return transporter;
}

/**
 * Check if the email service is configured and ready.
 */
function isEmailConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

/**
 * Get the sender email address.
 */
function getSenderEmail() {
  return process.env.EMAIL_USER || '';
}

/**
 * Send a warranty reminder email.
 * @param {Object} params
 * @param {string} params.recipientEmail - The logged-in user's email
 * @param {string} params.userName - The user's display name
 * @param {Object} params.purchase - The purchase document
 * @param {number} params.daysUntilExpiry - Days until warranty expires
 * @returns {Object} { success, message }
 */
async function sendWarrantyReminder({ recipientEmail, userName, purchase, daysUntilExpiry }) {
  const transport = getTransporter();
  if (!transport) {
    return { success: false, message: 'Email service not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD in backend/.env' };
  }

  const senderEmail = getSenderEmail();
  if (!recipientEmail) {
    return { success: false, message: 'Recipient email not found. User must have a valid email address.' };
  }

  const productName = purchase.productName || 'Your product';
  const brand = purchase.brand || 'N/A';
  const merchant = purchase.merchant || purchase.storeName || 'N/A';
  const purchaseDate = purchase.purchaseDate
    ? new Date(purchase.purchaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';
  const warrantyEnd = purchase.warrantyEnd
    ? new Date(purchase.warrantyEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';
  const invoiceNumber = purchase.invoiceNumber || 'N/A';

  const subject = `Warranty Reminder: Your ${productName} warranty expires soon`;

  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
      <div style="text-align: center; padding-bottom: 16px; border-bottom: 2px solid #3B82F6; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 22px; color: #1E293B;">🛡️ WarrantyVault AI</h1>
        <p style="margin: 4px 0 0; font-size: 13px; color: #64748B;">Smart Purchase & Warranty Manager</p>
      </div>

      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        Hello <strong>${escapeHtml(userName)}</strong>,
      </p>
      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        This is a reminder from your <strong>Purchase Vault</strong> that the warranty for your product is approaching its expiry date.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 18px; margin: 20px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
          <tr><td style="padding: 6px 0; font-weight: 600; color: #64748B; width: 140px;">Product:</td><td style="padding: 6px 0;">${escapeHtml(productName)}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600; color: #64748B;">Brand:</td><td style="padding: 6px 0;">${escapeHtml(brand)}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600; color: #64748B;">Merchant:</td><td style="padding: 6px 0;">${escapeHtml(merchant)}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600; color: #64748B;">Purchase Date:</td><td style="padding: 6px 0;">${purchaseDate}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600; color: #64748B;">Warranty Expiry:</td><td style="padding: 6px 0; color: #DC2626; font-weight: 700;">${warrantyEnd}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600; color: #64748B;">Invoice Number:</td><td style="padding: 6px 0;">${escapeHtml(invoiceNumber)}</td></tr>
        </table>
      </div>

      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        If your product has any issue covered under warranty, we recommend contacting the merchant/manufacturer before the warranty expires.
      </p>
      <p style="font-size: 15px; color: #334155; line-height: 1.6;">
        You can use your saved purchase receipt/invoice as proof of purchase.
      </p>

      <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">Regards,<br><strong style="color: #3B82F6;">Purchase Vault — WarrantyVault AI</strong></p>
      </div>
    </div>
  `;

  const textBody = `Hello ${userName},

This is a reminder from your Purchase Vault that the warranty for your product is approaching its expiry date.

Product: ${productName}
Brand: ${brand}
Merchant: ${merchant}
Purchase Date: ${purchaseDate}
Warranty Expiry: ${warrantyEnd}
Invoice Number: ${invoiceNumber}

If your product has any issue covered under warranty, we recommend contacting the merchant/manufacturer before the warranty expires.

You can use your saved purchase receipt/invoice as proof of purchase.

Regards,
Purchase Vault — WarrantyVault AI`;

  try {
    await transport.sendMail({
      from: `"WarrantyVault AI" <${senderEmail}>`,
      to: recipientEmail,
      subject,
      text: textBody,
      html: htmlBody
    });
    console.log(`[EmailService] Warranty reminder sent to ${recipientEmail} for "${productName}"`);
    return { success: true, message: 'Warranty reminder sent successfully.' };
  } catch (err) {
    console.error(`[EmailService] Failed to send email to ${recipientEmail}:`, err.message);
    return { success: false, message: `Unable to send email: ${err.message}` };
  }
}

/**
 * Simple HTML entity escape for email body.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendWarrantyReminder,
  isEmailConfigured,
  getSenderEmail
};
