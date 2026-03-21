const nodemailer = require('nodemailer');
const { config } = require('./config');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    if (!config.email.host || !config.email.user) {
      console.warn('Email not configured, skip create transporter');
      return null;
    }
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
    });
  }
  return transporter;
}

async function sendEmail(subject, body, toAddresses) {
  const t = getTransporter();
  if (!t) {
    console.warn('Email not configured, skip sendEmail');
    return;
  }
  const to = Array.isArray(toAddresses)
    ? toAddresses.join(',')
    : String(toAddresses || '');
  await t.sendMail({
    from: config.email.user,
    to,
    subject,
    text: body,
  });
}

module.exports = { sendEmail };

