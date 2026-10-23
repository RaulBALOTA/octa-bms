/**
 * Printable dunning letter (Mahnung). Level texts follow German practice:
 * 1 = Zahlungserinnerung, 2 = 1. Mahnung, 3 = 2. Mahnung / letzte Mahnung.
 */

interface CompanyProfile {
  name: string;
  legalName: string | null;
  vatId: string | null;
  commercialRegister: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
}

interface DunningInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  open: number;
  overdueDays: number;
  dunningLevel: number; // level AFTER incrementing = the letter being sent
  currencyCode: string;
  partner: {
    name: string;
    legalName?: string | null;
    street?: string | null;
    postalCode?: string | null;
    city?: string | null;
  };
}

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!,
  );

export function printDunning(
  invoice: DunningInvoice,
  company: CompanyProfile,
  locale: string,
): void {
  const de = locale.startsWith('de');
  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: invoice.currencyCode,
  }).format(invoice.open);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale).format(new Date(iso));
  const payBy = new Intl.DateTimeFormat(locale).format(
    new Date(Date.now() + 10 * 86_400_000),
  );

  const titles = de
    ? ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung — letzte Mahnung']
    : ['Payment reminder', 'First reminder', 'Second reminder — final notice'];
  const bodies = de
    ? [
        `sicher ist es Ihrer Aufmerksamkeit entgangen, dass die unten aufgeführte Rechnung noch offen ist. Wir bitten um Ausgleich bis zum <strong>${payBy}</strong>. Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.`,
        `auf unsere Zahlungserinnerung haben wir leider keinen Zahlungseingang feststellen können. Wir fordern Sie auf, den offenen Betrag bis zum <strong>${payBy}</strong> zu begleichen. Ab sofort befinden Sie sich gemäß § 286 BGB in Verzug; wir behalten uns die Berechnung von Verzugszinsen (§ 288 BGB) vor.`,
        `trotz unserer bisherigen Mahnungen ist der offene Betrag nicht eingegangen. Wir setzen Ihnen hiermit eine letzte Frist bis zum <strong>${payBy}</strong>. Nach fruchtlosem Ablauf werden wir die Forderung ohne weitere Ankündigung einem Inkassounternehmen bzw. unserem Rechtsbeistand übergeben. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.`,
      ]
    : [
        `we would like to remind you that the invoice listed below is still outstanding. Please settle the amount by <strong>${payBy}</strong>. If your payment has crossed this letter, please disregard it.`,
        `despite our payment reminder we have not received your payment. We request settlement of the open amount by <strong>${payBy}</strong>. You are now in default pursuant to § 286 BGB; we reserve the right to charge default interest (§ 288 BGB).`,
        `despite previous reminders the open amount remains unpaid. We herewith set a final deadline of <strong>${payBy}</strong>. Thereafter the claim will be handed to a collection agency or our legal counsel without further notice, at your expense.`,
      ];

  const level = Math.min(Math.max(invoice.dunningLevel, 1), 3);
  const address = [
    company.street,
    `${company.postalCode ?? ''} ${company.city ?? ''}`.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const html = `<!doctype html><html lang="${de ? 'de' : 'en'}"><head><meta charset="utf-8">
<title>${esc(titles[level - 1])} ${esc(invoice.invoiceNumber)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font: 13px/1.6 'Inter', system-ui, sans-serif; color:#1a1d26; padding:48px 56px; }
  .head { display:flex; justify-content:space-between; margin-bottom:40px; }
  .brand { font-size:19px; font-weight:700; }
  .muted { color:#6b7280; font-size:11px; }
  .sender { font-size:10px; color:#6b7280; border-bottom:1px solid #e5e7eb; padding-bottom:2px; margin-bottom:8px; }
  .addr { margin-bottom:36px; width:300px; }
  h1 { font-size:17px; margin:16px 0 12px; }
  table { width:100%; border-collapse:collapse; margin:20px 0; }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.04em;
    color:#6b7280; border-bottom:1.5px solid #1a1d26; padding:6px 8px; }
  td { padding:7px 8px; border-bottom:1px solid #e5e7eb; }
  .r { text-align:right; white-space:nowrap; }
  .total { font-weight:700; }
  footer { position:fixed; bottom:32px; left:56px; right:56px; border-top:1px solid #e5e7eb;
    padding-top:8px; font-size:9.5px; color:#6b7280; display:flex; justify-content:space-between; }
</style></head><body>
  <div class="head">
    <div><div class="brand">${esc(company.name)}</div><div class="muted">${esc(address)}</div></div>
    <div class="muted" style="text-align:right">${esc(company.phone ?? '')}<br>${esc(company.email ?? '')}</div>
  </div>
  <div class="addr">
    <div class="sender">${esc(company.legalName ?? company.name)} · ${esc(address)}</div>
    <strong>${esc(invoice.partner.legalName ?? invoice.partner.name)}</strong><br>
    ${esc(invoice.partner.street ?? '')}<br>
    ${esc(`${invoice.partner.postalCode ?? ''} ${invoice.partner.city ?? ''}`.trim())}
  </div>

  <div class="muted" style="text-align:right">${new Intl.DateTimeFormat(locale).format(new Date())}</div>
  <h1>${esc(titles[level - 1])}</h1>
  <p>${de ? 'Sehr geehrte Damen und Herren' : 'Dear Sir or Madam'},</p>
  <p style="margin-top:8px">${bodies[level - 1]}</p>

  <table>
    <thead><tr>
      <th>${de ? 'Rechnung' : 'Invoice'}</th><th>${de ? 'Rechnungsdatum' : 'Invoice date'}</th>
      <th>${de ? 'Fällig seit' : 'Due since'}</th><th class="r">${de ? 'Tage überfällig' : 'Days overdue'}</th>
      <th class="r">${de ? 'Offener Betrag' : 'Open amount'}</th>
    </tr></thead>
    <tbody><tr>
      <td>${esc(invoice.invoiceNumber)}</td><td>${date(invoice.invoiceDate)}</td>
      <td>${date(invoice.dueDate)}</td><td class="r">${esc(invoice.overdueDays)}</td>
      <td class="r total">${esc(money)}</td>
    </tr></tbody>
  </table>

  <p>${de ? 'Mit freundlichen Grüßen' : 'Kind regards'}<br><strong>${esc(company.name)}</strong></p>

  <footer>
    <span>${esc(company.legalName ?? company.name)}${company.commercialRegister ? ` · ${esc(company.commercialRegister)}` : ''}</span>
    <span>${company.vatId ? `USt-IdNr.: ${esc(company.vatId)}` : ''}</span>
  </footer>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const win = window.open('', '_blank', 'width=840,height=1100');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
