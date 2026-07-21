import nodemailer from 'nodemailer';
import { config } from '../config';

const transporter = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export async function sendMail(to: string[], subject: string, text: string): Promise<void> {
  if (!transporter) {
    console.log(`[mailer:disabled] to=${to.join(',')} subject=${subject}`);
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, text });
}
