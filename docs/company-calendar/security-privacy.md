# Security and privacy

Every calendar route inherits existing JWT, company membership, RBAC and throttling. Every item read, count, search, detail and mutation intersects companyId, deletedAt, domain permission and sensitivity. Global system administration does not bypass private item visibility.

- Public internal: domain-authorized company readers.
- Team/restricted/private: creator, owner or explicit per-item grantee only. No implicit manager access.
- HR: hr.reviews.read, intentionally stronger than employee-directory access.
- Finance: finance.invoices.read.
- Corporate/sales: existing dashboard/opportunity read permissions.
- Operations/meetings/commitments: calendar.items.read.

Edits also require calendar.items.update plus creator/owner/edit grant; approvers/system admins may edit public internal items. Only owner/creator may widen sensitivity or edit sharing. Grant targets and owners must be active members of the same company. Sensitive invoice/employee links must stay in Finance/HR respectively. Linked references are selected from actual company data through existing module permissions; source rows are not edited.

Writes use conditional version updates inside transactions with immutable history; parallel evidence/edit/completion cannot lose an intervening update. History is limited to owner/creator to avoid exposing previous private snapshots to later read-only recipients. All writes to provider-owned records are refused. External mirror archival has no relation that can delete an OCTA obligation.

No Microsoft credentials, mailbox contents, chats or AI requests are created. Evidence/source URLs require HTTPS; they are displayed as noreferrer links, never fetched server-side. There is no SSRF fetch or external message sender in the calendar module. Existing retention/user deletion infrastructure is not altered; GDPR purge/export remains future hardening. Stored evidence is a link, not an automatic verification claim.
