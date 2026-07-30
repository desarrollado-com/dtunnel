import nodemailer from 'nodemailer';

export function getMailer() {
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  const transporter = getMailer();
  if (!transporter) throw new Error('SMTP no configurado');
  const from = process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM;
  const fromName = process.env.SMTP_FROM_NAME || 'dtunnel';
  await transporter.sendMail({
    from: `"${fromName}" <${from}>`,
    to,
    subject: 'Restablecer contraseña — dtunnel',
    text: `Hola,\n\nRestablece tu contraseña en dtunnel:\n${resetUrl}\n\nEl enlace expira en 1 hora.\n\nSi no solicitaste esto, ignora este mensaje.`,
    html: `
      <p>Hola,</p>
      <p>Restablece tu contraseña en dtunnel:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>El enlace expira en <strong>1 hora</strong>.</p>
      <p>Si no solicitaste esto, ignora este mensaje.</p>
    `,
  });
}
