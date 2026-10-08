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
  /** ответ на письмо уйдёт сюда (адрес пользователя в обращениях) */
  replyTo?: string;
  /** вложения: base64 */
  attachments?: { name: string; content: string }[];
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
        body: JSON.stringify({
          sender: { email: from, name },
          to: [{ email: m.to }],
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
          ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
          ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.name, content: a.content })) } : {}),
        }),
      });
      if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    };
  }
  if (env.RESEND_API_KEY && from) {
    return async (m) => {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${name} <${from}>`,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
          ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.name, content: a.content })) } : {}),
        }),
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
<tr><td align="center" style="padding-bottom:16px"><div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#5AC8FA,#007AFF 55%,#3634A3);color:#fff;font-size:36px;font-weight:700;line-height:64px">S</div></td></tr>
<tr><td style="font-size:22px;font-weight:700;color:#000;text-align:center;padding-bottom:8px">Восстановление пароля</td></tr>
<tr><td style="font-size:16px;color:#3c3c43;text-align:center;line-height:1.5;padding-bottom:22px">${hello} Введите этот код в SuperMind, чтобы задать новый пароль:</td></tr>
<tr><td align="center" style="padding-bottom:22px"><div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:8px;color:#007aff;background:#eef5ff;border-radius:14px;padding:14px 22px">${code}</div></td></tr>
<tr><td style="font-size:14px;color:#8e8e93;text-align:center;line-height:1.5">Код действует 15 минут. Если вы не запрашивали восстановление — просто проигнорируйте письмо, пароль не изменится.</td></tr>
</table></td></tr></table></body></html>`,
  };
}

/** Обращение в поддержку — письмо владельцу */
export function feedbackMail(to: string, f: { id: string; kind: string; text: string; email: string; name: string; meta: string; image?: string }): Mail {
  const title = f.kind === 'idea' ? 'Идея' : 'Проблема';
  return {
    to,
    replyTo: f.email,
    subject: `SuperMind · ${title} #${f.id} от ${f.name || f.email}`,
    text: `${title} #${f.id}\nОт: ${f.name} <${f.email}>\n\n${f.text}\n\n— ${f.meta}\n\nОтветьте на это письмо — ответ придёт пользователю.`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px">
<p style="margin:0 0 4px;color:#8e8e93;font-size:13px">${title} #${esc(f.id)}</p>
<p style="margin:0 0 14px;font-size:15px"><b>${esc(f.name || '')}</b> &lt;${esc(f.email)}&gt;</p>
<div style="white-space:pre-wrap;font-size:16px;line-height:1.5;background:#f2f2f7;border-radius:12px;padding:14px 16px">${esc(f.text)}</div>
<p style="margin:14px 0 0;color:#8e8e93;font-size:13px">${esc(f.meta)}</p>
<p style="margin:10px 0 0;color:#8e8e93;font-size:13px">Ответьте на это письмо — ответ придёт пользователю.</p></div>`,
    attachments: f.image ? [{ name: `screenshot-${f.id}.jpg`, content: f.image }] : undefined,
  };
}
