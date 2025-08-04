const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.initializeTransporter();
  }

  async initializeTransporter() {
    try {
      // Check if we have production email credentials
      const emailConfig = {
        service: process.env.EMAIL_SERVICE || 'gmail',
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER || 'fairpass.demo@gmail.com', // Your Gmail address
          pass: process.env.EMAIL_PASS || 'your-app-password-here'    // Your Gmail App Password
        }
      };

      // For demo purposes, create a working configuration
      // In production, you should set EMAIL_USER and EMAIL_PASS environment variables
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('🔧 Using demo email configuration');
        console.log('📧 To enable real email delivery:');
        console.log('   1. Create a Gmail account for FairPass');
        console.log('   2. Enable 2-Factor Authentication');
        console.log('   3. Generate an App Password');
        console.log('   4. Set EMAIL_USER=your-gmail@gmail.com');
        console.log('   5. Set EMAIL_PASS=your-app-password');
        console.log('');
        
        // For now, use a fallback that logs emails instead of sending them
        this.initialized = false;
        return;
      }

      this.transporter = nodemailer.createTransport(emailConfig);

      // Verify the connection
      await this.transporter.verify();

      this.initialized = true;
      console.log('📧 Email service initialized successfully with:', emailConfig.auth.user);
    } catch (error) {
      console.error('❌ Failed to initialize email service:', error.message);
      console.log('📧 Falling back to console logging mode');
      this.initialized = false;
    }
  }

  async sendVerificationEmail(data) {
    const { to, firstName, verificationUrl } = data;

    const subject = '🎫 Welcome to FairPass - Please Verify Your Email';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7C3AED; margin: 0;">🎫 FairPass</h1>
          <p style="color: #6B7280; margin: 5px 0;">Blockchain Ticketing for Good</p>
        </div>
        
        <div style="background: #F9FAFB; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          <h2 style="color: #1F2937; margin-top: 0;">Welcome to FairPass, ${firstName}! 👋</h2>
          
          <p style="color: #4B5563; line-height: 1.6;">
            Thank you for registering with FairPass! To complete your account setup and start purchasing tickets, 
            please verify your email address by clicking the button below.
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background: #7C3AED; color: white; padding: 15px 30px; text-decoration: none; 
                      border-radius: 8px; font-weight: bold; display: inline-block;">
              ✅ Verify My Email
            </a>
          </div>
          
          <p style="color: #6B7280; font-size: 14px; margin-top: 20px;">
            This verification link will expire in 24 hours for security reasons.
          </p>
        </div>
        
        <div style="background: #EFF6FF; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #1D4ED8; margin-top: 0;">🚀 What's Next?</h3>
          <p style="color: #1E40AF; margin: 10px 0;">After verification, you'll be able to:</p>
          <ul style="color: #1E40AF; margin: 10px 0;">
            <li>Browse and purchase event tickets securely</li>
            <li>Transfer tickets with anti-fraud protection</li>
            <li>Access dynamic QR codes for venue entry</li>
            <li>Enjoy fair pricing with anti-scalping features</li>
          </ul>
        </div>
        
        <div style="border-top: 1px solid #E5E7EB; padding-top: 20px; text-align: center;">
          <p style="color: #6B7280; font-size: 14px; margin: 5px 0;">
            If you didn't create this account, you can safely ignore this email.
          </p>
          <p style="color: #6B7280; font-size: 14px; margin: 5px 0;">
            If the button doesn't work, copy this link: <br>
            <a href="${verificationUrl}" style="color: #7C3AED; word-break: break-all;">${verificationUrl}</a>
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
          <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
            FairPass - Fair, Secure, Sustainable Ticketing
          </p>
        </div>
      </div>
    `;

    const text = `
Welcome to FairPass, ${firstName}!

Thank you for registering! Please verify your email address to complete your account setup.

Click here to verify: ${verificationUrl}

This link will expire in 24 hours.

If you didn't create this account, you can safely ignore this email.

FairPass - Fair, Secure, Sustainable Ticketing
    `;

    return this.sendEmail({ to, subject, html, text });
  }

  async sendTransferNotification(transferData) {
    const {
      recipientEmail,
      senderEmail,
      senderName,
      ticketDetails,
      transferId,
      price,
      isResale
    } = transferData;

    const subject = isResale 
      ? `🎫 Ticket Purchase Offer - ${ticketDetails.eventName}`
      : `🎫 Ticket Transfer - ${ticketDetails.eventName}`;

    const actionUrl = `http://localhost:3000/transfer/${transferId}`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .content { padding: 30px; }
          .ticket-card { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #667eea; }
          .price-section { background: ${isResale ? '#fff3cd' : '#d1ecf1'}; border-radius: 8px; padding: 15px; margin: 15px 0; }
          .action-buttons { text-align: center; margin: 30px 0; }
          .btn { display: inline-block; padding: 12px 30px; margin: 10px; text-decoration: none; border-radius: 6px; font-weight: bold; }
          .btn-accept { background: #28a745; color: white; }
          .btn-reject { background: #dc3545; color: white; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
          .security-notice { background: #e7f3ff; border: 1px solid #b8daff; border-radius: 6px; padding: 15px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎫 FairPass</h1>
            <h2>${isResale ? 'Ticket Purchase Offer' : 'Ticket Transfer'}</h2>
          </div>
          
          <div class="content">
            <p>Hello!</p>
            
            <p><strong>${senderName || senderEmail}</strong> wants to ${isResale ? 'sell' : 'transfer'} a ticket to you:</p>
            
            <div class="ticket-card">
              <h3>🎵 ${ticketDetails.eventName}</h3>
              <p><strong>📅 Date:</strong> ${ticketDetails.date}</p>
              <p><strong>📍 Venue:</strong> ${ticketDetails.venue}</p>
              <p><strong>🎫 Ticket Type:</strong> ${ticketDetails.type || 'General Admission'}</p>
              <p><strong>🆔 Ticket ID:</strong> #${ticketDetails.ticketId}</p>
            </div>
            
            ${price ? `
            <div class="price-section">
              <h4>${isResale ? '💰 Purchase Price' : '💸 Transfer Fee'}</h4>
              <p><strong>${price} ETH</strong></p>
              ${isResale ? '<p><small>✅ Price verified to be within fair resale limits</small></p>' : ''}
            </div>
            ` : ''}
            
            <div class="security-notice">
              <h4>🔒 Secure Transfer Process</h4>
              <ul>
                <li>✅ Verified ticket ownership</li>
                <li>🛡️ Anti-fraud protection enabled</li>
                <li>⏰ Dynamic QR codes prevent copying</li>
                <li>🎯 One-time use verification</li>
              </ul>
            </div>
            
            <div class="action-buttons">
              <a href="${actionUrl}?action=accept" class="btn btn-accept">
                ✅ Accept ${isResale ? 'Purchase' : 'Transfer'}
              </a>
              <a href="${actionUrl}?action=reject" class="btn btn-reject">
                ❌ Decline
              </a>
            </div>
            
            <p><strong>Important:</strong> You need a FairPass account to accept this ${isResale ? 'purchase' : 'transfer'}. If you don't have one, you'll be prompted to register.</p>
            
            <p><small>⚠️ This ${isResale ? 'offer' : 'transfer'} will expire in 24 hours for security reasons.</small></p>
          </div>
          
          <div class="footer">
            <p>🎫 FairPass - Blockchain Ticketing for Good</p>
            <p>This email was sent because someone initiated a ticket ${isResale ? 'sale' : 'transfer'} to your email address.</p>
            <p>If you didn't expect this, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
FairPass - ${subject}

${senderName || senderEmail} wants to ${isResale ? 'sell' : 'transfer'} a ticket to you:

Event: ${ticketDetails.eventName}
Date: ${ticketDetails.date}
Venue: ${ticketDetails.venue}
Ticket ID: #${ticketDetails.ticketId}
${price ? `Price: ${price} ETH` : ''}

To accept or decline this ${isResale ? 'purchase' : 'transfer'}, visit:
${actionUrl}

This ${isResale ? 'offer' : 'transfer'} expires in 24 hours.

FairPass - Secure Blockchain Ticketing
    `;

    return this.sendEmail({
      to: recipientEmail,
      subject,
      html: htmlContent,
      text: textContent
    });
  }

  async sendTransferConfirmation(transferData) {
    const {
      senderEmail,
      recipientEmail,
      ticketDetails,
      action, // 'accepted' or 'rejected'
      price
    } = transferData;

    const subject = `🎫 Transfer ${action === 'accepted' ? 'Completed' : 'Declined'} - ${ticketDetails.eventName}`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: ${action === 'accepted' ? '#28a745' : '#dc3545'}; color: white; padding: 30px; text-align: center; }
          .content { padding: 30px; }
          .ticket-card { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎫 FairPass</h1>
            <h2>Transfer ${action === 'accepted' ? 'Completed!' : 'Declined'}</h2>
          </div>
          
          <div class="content">
            ${action === 'accepted' ? `
              <p>Great news! Your ticket transfer has been completed successfully.</p>
              <p><strong>${recipientEmail}</strong> has accepted the ticket for:</p>
            ` : `
              <p>Your ticket transfer has been declined.</p>
              <p><strong>${recipientEmail}</strong> declined the ticket for:</p>
            `}
            
            <div class="ticket-card">
              <h3>🎵 ${ticketDetails.eventName}</h3>
              <p><strong>📅 Date:</strong> ${ticketDetails.date}</p>
              <p><strong>📍 Venue:</strong> ${ticketDetails.venue}</p>
              <p><strong>🆔 Ticket ID:</strong> #${ticketDetails.ticketId}</p>
              ${price ? `<p><strong>💰 Price:</strong> ${price} ETH</p>` : ''}
            </div>
            
            ${action === 'accepted' ? `
              <p>✅ The ticket has been removed from your account and transferred to the recipient.</p>
              <p>🎯 They can now generate secure QR codes for venue entry.</p>
            ` : `
              <p>🎫 The ticket remains in your account and you can try transferring to someone else.</p>
            `}
          </div>
          
          <div class="footer">
            <p>🎫 FairPass - Blockchain Ticketing for Good</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: senderEmail,
      subject,
      html: htmlContent
    });
  }

  async sendEmail({ to, subject, html, text }) {
    try {
      if (!this.initialized || !this.transporter) {
        // Enhanced fallback for demo - extract verification URL if present
        let verificationUrl = '';
        if (html && html.includes('http://localhost:3000/auth/verify?token=')) {
          const urlMatch = html.match(/http:\/\/localhost:3000\/auth\/verify\?token=([a-f0-9]+)/);
          if (urlMatch) {
            verificationUrl = urlMatch[0];
          }
        }

        console.log(`
========================================
📧 EMAIL NOTIFICATION (Demo Mode)
========================================
To: ${to}
Subject: ${subject}
${verificationUrl ? `🔗 Verification URL: ${verificationUrl}` : ''}
========================================

⚠️  EMAIL NOT ACTUALLY SENT - DEMO MODE ACTIVE

To enable real email delivery:
1. Create a Gmail account for FairPass
2. Enable 2-Factor Authentication  
3. Generate an App Password
4. Set environment variables:
   EMAIL_USER=your-gmail@gmail.com
   EMAIL_PASS=your-app-password

For now, ${verificationUrl ? 'copy the verification URL above' : 'check the email content below'}:
${verificationUrl ? '👆 Use this URL to verify the account' : (text || 'HTML email content')}

========================================
`);
        return { 
          success: true, 
          messageId: 'demo-' + Date.now(), 
          demoMode: true,
          verificationUrl: verificationUrl || null
        };
      }

      const info = await this.transporter.sendMail({
        from: '"FairPass" <noreply@fairpass.demo>',
        to,
        subject,
        text,
        html
      });

      console.log('📧 Email sent successfully to:', to);
      console.log('📧 Message ID:', info.messageId);
      
      return { 
        success: true, 
        messageId: info.messageId,
        recipient: to
      };
    } catch (error) {
      console.error('❌ Failed to send email:', error);
      
      // Fallback to console logging
      console.log(`
📧 EMAIL NOTIFICATION (Error Fallback):
To: ${to}
Subject: ${subject}
Error: ${error.message}
---
${text || 'HTML email content'}
---
`);
      
      return { success: false, error: error.message, fallback: true };
    }
  }
}

module.exports = EmailService; 