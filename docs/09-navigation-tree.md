# 09 — Navigation Tree

Data-driven (served by API, filtered by permissions). German labels in parentheses.

```
🏠 Home (Start)
   ├─ My Dashboard
   ├─ My Approvals
   ├─ My Tasks
   └─ Activity Feed
⭐ Favorites (pinned records & views, user-managed)

📊 Corporate (Unternehmenssteuerung)          [perm: corporate.*]
   ├─ Executive Dashboard
   ├─ Company KPIs & Goals (Unternehmensziele)
   ├─ Budget & Forecast
   ├─ Business Units · Departments · Offices
   ├─ Organization Chart (Organigramm)
   ├─ Company Calendar
   ├─ Announcements (Mitteilungen)
   └─ Management Reports

👥 CRM
   ├─ Clients (Kunden) · Suppliers (Lieferanten) · Partners · Authorities (Behörden)
   ├─ Contacts (Ansprechpartner)
   ├─ Activities (Aktivitäten: calls, emails, meetings, visits)
   ├─ Leads
   ├─ Segments & Industries
   └─ Map View (Kartenansicht)

💼 Sales (Vertrieb)
   ├─ Pipeline (Kanban)
   ├─ Opportunities (Verkaufschancen)
   ├─ Go/No-Go Decisions
   ├─ Proposals (Angebote)
   ├─ Fee Calculations (Honorarkalkulation)
   ├─ Submission Calendar (Abgabekalender)
   ├─ Reference Projects (Referenzen)
   ├─ CV Library (Lebenslauf-Bibliothek)
   ├─ Competitors (Wettbewerber)
   └─ Win/Loss Analysis

📄 Contracts (Verträge)
   ├─ Client Contracts · Supplier Contracts · Framework Agreements (Rahmenverträge)
   ├─ NDAs
   ├─ Obligations (Vertragspflichten)
   ├─ Payment Milestones
   ├─ Variation Orders (Nachträge) · Claims
   ├─ Bank Guarantees (Bürgschaften)
   ├─ Insurance (Versicherungen)
   └─ Expiry Monitor (Fristenüberwachung)

💶 Finance (Finanzen)
   ├─ Financial Dashboard
   ├─ Outgoing Invoices (Ausgangsrechnungen)
   ├─ Incoming Invoices (Eingangsrechnungen)
   ├─ Payments (Zahlungen) · Bank Accounts
   ├─ Accounts Receivable / Payable (OP-Listen)
   ├─ Cash Flow
   ├─ Budgets · Cost Centers · Profit Centers
   ├─ VAT / Tax Codes (Steuer)
   └─ DATEV Export · ERP Interfaces

🧑‍💼 HR (Personal)
   ├─ Employees (Mitarbeiter) · Org Chart
   ├─ Employment Contracts
   ├─ Skills & Competence Matrix (Kompetenzmatrix)
   ├─ Certificates (Zertifikate) · Training (Schulungen)
   ├─ Leave (Urlaub & Abwesenheiten) · Leave Calendar
   ├─ Business Trips (Dienstreisen)
   ├─ Working time (/time): My time · Team & approvals · Capacity planning ·
   │    Work schedules · PMO connection — see docs/working-time.md
   ├─ Recruitment: Openings · Applicants · Interviews
   ├─ Performance Reviews (Mitarbeitergespräche)
   ├─ Onboarding
   └─ Company Equipment (from Assets)

⚖ Legal & Compliance (Recht)
   ├─ Compliance Register · GDPR (DSGVO): Processing Register (VVT)
   ├─ ISO Documents · Policies (Richtlinien)
   ├─ Legal Cases (Rechtsfälle)
   ├─ Professional Licenses (Berufszulassungen) · Commercial Register
   ├─ Whistleblower Portal (Hinweisgebersystem)
   └─ Audit & Retention Register

🛒 Procurement (Einkauf)
   ├─ Purchase Requests (Bestellanforderungen)
   ├─ Purchase Orders (Bestellungen)
   ├─ Receiving (Wareneingang)
   ├─ Supplier Evaluation (Lieferantenbewertung)
   ├─ Software Licenses
   └─ Inventory (Bestand)

🖥 Assets (Anlagen & Geräte)
   ├─ All Assets · IT · Vehicles (Fuhrpark) · Phones · Furniture
   ├─ Assignments (Ausgaben/Rückgaben)
   ├─ Maintenance & Calibration (Wartung/Kalibrierung/TÜV)
   ├─ Warranties
   └─ QR Labels

📚 Knowledge (Wissen)
   ├─ Wiki · Corporate Standards · Procedures (Verfahrensanweisungen)
   ├─ Engineering Standards · Templates (Vorlagen)
   ├─ Lessons Learned · FAQ
   └─ 🤖 Ask Company Knowledge

📁 Documents (Dokumente)
   ├─ Browse Folders · Recent · Checked Out by Me
   ├─ Retention (Aufbewahrung)
   └─ Full-Text Search

💬 Communication (Kommunikation)
   ├─ Message Center · Meeting Minutes (Protokolle)
   ├─ Email Templates · Announcements
   └─ Outlook / Teams settings

⚙ Administration                                [perm: admin.*]
   ├─ Master Data: Companies · Offices · Departments · Reference data
   │  (countries, currencies, tax codes, contract/document types,
   │   asset categories, vehicle types, banks, approval groups)
   ├─ Users · Roles & Permissions · Groups
   ├─ SSO / Entra · MFA · Password Policies · API Keys
   ├─ Workflow Designer · Email Templates · Custom Fields
   ├─ Number Sequences · Audit Log · System Health
   └─ Plugins & Integrations (PMO, DATEV, BC/SAP, Power BI)

📈 BI & Reports (Auswertungen)   — cross-module: dashboards, report builder,
   scheduled reports, exports, AI insights, Power BI links
```

Rules: max 2 nav levels in the sidebar (deeper = tabs inside pages); every leaf is
favoritable; badge counts on Approvals/Tasks/Expiry Monitor; admin group visible only
with admin permissions.
