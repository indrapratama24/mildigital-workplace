// Optional email channel. In-app notifications are always written; email is best-effort.
// To activate real email, implement EmailAdapter (e.g. SMTP via nodemailer, Resend, SES) and
// return it from getEmailAdapter() for a new EMAIL_ADAPTER value.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  link?: string;
}

export interface EmailAdapter {
  name: string;
  send(msg: EmailMessage): Promise<void>;
}

const noop: EmailAdapter = { name: "none", send: async () => {} };
const consoleAdapter: EmailAdapter = {
  name: "console",
  send: async (m) => {
    console.info(`[email] to=${m.to} subject="${m.subject}" link=${m.link ?? "-"}\n${m.text}`);
  },
};

export function getEmailAdapter(): EmailAdapter {
  switch (process.env.EMAIL_ADAPTER) {
    case "console":
      return consoleAdapter;
    default:
      return noop;
  }
}
