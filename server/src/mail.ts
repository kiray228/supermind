/**
 * Отправка писем (восстановление пароля). Провайдер выбирается по переменным окружения:
 *   BREVO_API_KEY  — Brevo (бесплатно 300 писем в день; отправитель — подтверждённый в Brevo адрес)
 *   RESEND_API_KEY — Resend (нужен свой домен)
 *   MAIL_FROM      — адрес отправителя, MAIL_NAME — имя (по умолчанию «SuperMind»)
 */
export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export type Mailer = (m: Mail) => Promise<void>;

export class MailNotConfigured extends Error {}

export function envMailer(env: Record<string, string | undefined> = process.env): Mailer | null {
  const from = env.MAIL_FROM;
  const name = env.MAIL_NAME || 'SuperMind';
  if (env.BREVO_API_KEY && from) {
    return async (m) => {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY!, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { email: from, name }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text }),
      });
      if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    };
  }
  if (env.RESEND_API_KEY && from) {
    return async (m) => {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${name} <${from}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    };
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Письмо с кодом восстановления */
export function resetMail(to: string, name: string, code: string): Mail {
  const hello = name ? `Здравствуйте, ${esc(name)}!` : 'Здравствуйте!';
  return {
    to,
    subject: `Код для входа в SuperMind: ${code}`,
    text: `${hello.replace(/&[a-z]+;/g, '')}\n\nКод для восстановления пароля SuperMind: ${code}\nОн действует 15 минут.\n\nЕсли вы не запрашивали код — просто проигнорируйте письмо, пароль не изменится.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:20px;padding:32px 28px">
<tr><td align="center" style="padding-bottom:16px"><div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#34D399,#10B981 55%,#0E7490);color:#fff;font-size:32px;line-height:64px">🌱</div></td></tr>
<tr><td style="font-size:22px;font-weight:700;color:#000;text-align:center;padding-bottom:8px">Восстановление пароля</td></tr>
<tr><td style="font-size:16px;color:#3c3c43;text-align:center;line-height:1.5;padding-bottom:22px">${hello} Введите этот код в SuperMind, чтобы задать новый пароль:</td></tr>
<tr><td align="center" style="padding-bottom:22px"><div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:8px;color:#0c9f6e;background:#ecfdf5;border-radius:14px;padding:14px 22px">${code}</div></td></tr>
<tr><td style="font-size:14px;color:#8e8e93;text-align:center;line-height:1.5">Код действует 15 минут. Если вы не запрашивали восстановление — просто проигнорируйте письмо, пароль не изменится.</td></tr>
</table></td></tr></table></body></html>`,
  };
}
