/**
 * §14 UStG-compliant invoice print view: opens a print-ready window with all
 * mandatory invoice elements (full names/addresses of both parties, tax
 * number or VAT ID, issue date, sequential invoice number, service date,
 * quantities and descriptions, net amounts per rate, tax rate and amount,
 * gross total). PDF generation later replaces window.print(); the template
 * stays.
 */

interface CompanyProfile {
  name: string;
  legalName: string | null;
  vatId: string | null;
  taxNumber: string | null;
  commercialRegister: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

interface PrintableInvoice {
  invoiceNumber: string;
  direction: string;
  invoiceDate: string;
  serviceDate: string | null;
  dueDate: string;
  currencyCode: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  reference: string | null;
  partner: {
    name: string;
    legalName?: string | null;
    street?: string | null;
    postalCode?: string | null;
    city?: string | null;
    vatId?: string | null;
  };
  lines: {
    position: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    netAmount: string;
    taxCode: { code: string; ratePercent: string };
  }[];
}

const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!,
  );

export function printInvoice(
  invoice: PrintableInvoice,
  company: CompanyProfile,
  locale: string,
): void {
  const money = (value: string | number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: invoice.currencyCode,
    }).format(Number(value));
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale).format(new Date(iso)) : '—';
  const de = locale.startsWith('de');
  const L = de
    ? {
        invoice: 'Rechnung',
        number: 'Rechnungsnummer',
        invoiceDate: 'Rechnungsdatum',
        serviceDate: 'Leistungsdatum',
        dueDate: 'Zahlbar bis',
        reference: 'Ihre Referenz',
        pos: 'Pos.',
        description: 'Leistung',
        qty: 'Menge',
        price: 'Einzelpreis',
        net: 'Netto',
        vat: 'USt.',
        gross: 'Gesamtbetrag',
        vatId: 'USt-IdNr.',
        taxNo: 'Steuernummer',
        payHint: 'Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer.',
      }
    : {
        invoice: 'Invoice',
        number: 'Invoice number',
        invoiceDate: 'Invoice date',
        serviceDate: 'Service date',
        dueDate: 'Payable by',
        reference: 'Your reference',
        pos: 'Pos.',
        description: 'Description',
        qty: 'Qty',
        price: 'Unit price',
        net: 'Net',
        vat: 'VAT',
        gross: 'Total amount',
        vatId: 'VAT ID',
        taxNo: 'Tax number',
        payHint: 'Please transfer the amount quoting the invoice number.',
      };

  const rate = invoice.lines[0]?.taxCode.ratePercent ?? '19';
  const address = [
    company.street,
    `${company.postalCode ?? ''} ${company.city ?? ''}`.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const rows = invoice.lines
    .map(
      (line) => `
      <tr>
        <td class="c">${line.position}</td>
        <td>${esc(line.description)}</td>
        <td class="r">${esc(Number(line.quantity))} ${esc(line.unit)}</td>
        <td class="r">${money(line.unitPrice)}</td>
        <td class="r">${money(line.netAmount)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!doctype html><html lang="${de ? 'de' : 'en'}"><head><meta charset="utf-8">
<title>${esc(L.invoice)} ${esc(invoice.invoiceNumber)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font: 13px/1.5 'Inter', system-ui, sans-serif; color:#1a1d26; padding:48px 56px; }
  .head { display:flex; justify-content:space-between; margin-bottom:40px; }
  .brand { font-size:19px; font-weight:700; }
  .muted { color:#6b7280; font-size:11px; }
  .sender { font-size:10px; color:#6b7280; border-bottom:1px solid #e5e7eb; padding-bottom:2px; margin-bottom:8px; }
  .addr { margin-bottom:36px; width:300px; }
  h1 { font-size:17px; margin-bottom:4px; }
  .meta { margin:16px 0 24px; }
  .meta td { padding:1px 24px 1px 0; font-size:12px; }
  table.lines { width:100%; border-collapse:collapse; margin-bottom:16px; }
  table.lines th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.04em;
    color:#6b7280; border-bottom:1.5px solid #1a1d26; padding:6px 8px; }
  table.lines td { padding:7px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  .r { text-align:right; white-space:nowrap; } .c { text-align:center; }
  .totals { margin-left:auto; width:260px; font-size:13px; }
  .totals td { padding:3px 0; }
  .totals .sum td { border-top:1.5px solid #1a1d26; font-weight:700; padding-top:6px; }
  .hint { margin-top:28px; font-size:12px; }
  footer { position:fixed; bottom:32px; left:56px; right:56px; border-top:1px solid #e5e7eb;
    padding-top:8px; font-size:9.5px; color:#6b7280; display:flex; justify-content:space-between; }
  @media print { body { padding:24px 32px; } footer { bottom:16px; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="brand">${esc(company.name)}</div>
      <div class="muted">${esc(address)}</div>
    </div>
    <div class="muted" style="text-align:right">
      ${esc(company.phone ?? '')}<br>${esc(company.email ?? '')}<br>${esc(company.website ?? '')}
    </div>
  </div>

  <div class="addr">
    <div class="sender">${esc(company.legalName ?? company.name)} · ${esc(address)}</div>
    <strong>${esc(invoice.partner.legalName ?? invoice.partner.name)}</strong><br>
    ${esc(invoice.partner.street ?? '')}<br>
    ${esc(`${invoice.partner.postalCode ?? ''} ${invoice.partner.city ?? ''}`.trim())}
    ${invoice.partner.vatId ? `<div class="muted">${esc(L.vatId)}: ${esc(invoice.partner.vatId)}</div>` : ''}
  </div>

  <h1>${esc(L.invoice)} ${esc(invoice.invoiceNumber)}</h1>
  <table class="meta"><tr>
    <td><span class="muted">${esc(L.invoiceDate)}</span><br>${date(invoice.invoiceDate)}</td>
    <td><span class="muted">${esc(L.serviceDate)}</span><br>${date(invoice.serviceDate)}</td>
    <td><span class="muted">${esc(L.dueDate)}</span><br>${date(invoice.dueDate)}</td>
    ${invoice.reference ? `<td><span class="muted">${esc(L.reference)}</span><br>${esc(invoice.reference)}</td>` : ''}
  </tr></table>

  <table class="lines">
    <thead><tr>
      <th>${esc(L.pos)}</th><th>${esc(L.description)}</th>
      <th class="r">${esc(L.qty)}</th><th class="r">${esc(L.price)}</th><th class="r">${esc(L.net)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>${esc(L.net)}</td><td class="r">${money(invoice.netAmount)}</td></tr>
    <tr><td>${esc(L.vat)} ${esc(Number(rate))}%</td><td class="r">${money(invoice.taxAmount)}</td></tr>
    <tr class="sum"><td>${esc(L.gross)}</td><td class="r">${money(invoice.grossAmount)}</td></tr>
  </table>

  <p class="hint">${esc(L.payHint)}</p>

  <footer>
    <span>${esc(company.legalName ?? company.name)}${company.commercialRegister ? ` · ${esc(company.commercialRegister)}` : ''}</span>
    <span>${company.vatId ? `${esc(L.vatId)}: ${esc(company.vatId)}` : company.taxNumber ? `${esc(L.taxNo)}: ${esc(company.taxNumber)}` : ''}</span>
  </footer>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const win = window.open('', '_blank', 'width=840,height=1100');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
