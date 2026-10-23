/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ---------------------------------------------------------------- permissions
const MODULES: Record<string, string[]> = {
  calendar: ['items'],
  corporate: ['dashboard', 'goals', 'announcements'],
  crm: ['partners', 'contacts', 'activities'],
  sales: ['opportunities', 'proposals', 'gonogo'],
  contracts: ['contracts', 'guarantees', 'insurance'],
  finance: ['invoices', 'payments', 'budgets', 'datev'],
  hr: ['employees', 'leave', 'recruitment', 'reviews', 'trainings'],
  legal: ['cases', 'gdpr', 'compliance', 'whistleblower'],
  procurement: ['requests', 'orders', 'evaluations'],
  assets: ['assets', 'licenses'],
  knowledge: ['articles'],
  documents: ['documents', 'folders'],
  communication: ['meetings', 'messages', 'mail'],
  workflow: ['definitions', 'tasks'],
  bi: ['dashboards', 'reports'],
  identity: ['users', 'roles', 'groups', 'apikeys', 'security'],
  admin: ['masterdata', 'audit', 'settings'],
};
const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'export'];

async function seedPermissions() {
  const data = Object.entries(MODULES).flatMap(([module, resources]) =>
    resources.flatMap((resource) =>
      ACTIONS.map((action) => ({
        code: `${module}.${resource}.${action}`,
        module,
        resource,
        action,
        name: `${action} ${resource} (${module})`,
      })),
    ),
  );
  for (const p of data) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
  }
  console.log(`✔ ${data.length} permissions`);
}

async function seedRole(code: string, name: string, patterns: RegExp[]) {
  const all = await prisma.permission.findMany();
  const matched = all.filter((p) => patterns.some((rx) => rx.test(p.code)));
  const role = await prisma.role.upsert({
    where: { code },
    update: {},
    create: { code, name, isSystem: true },
  });
  for (const p of matched) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      update: {},
      create: { roleId: role.id, permissionId: p.id },
    });
  }
  return role;
}

async function main() {
  console.log('Seeding OCTA BMS…');

  await seedPermissions();

  // ------------------------------------------------------------------- roles
  const adminRole = await seedRole('SYSTEM_ADMIN', 'System Administrator', [/.*/]);
  const mdRole = await seedRole('MANAGING_DIRECTOR', 'Managing Director', [
    /\.read$/, /\.approve$/, /\.export$/, /^corporate\./, /^calendar\./,
  ]);
  const salesRole = await seedRole('SALES_MANAGER', 'Sales Manager', [
    /^calendar\.items\.(read|create|update)$/,
    /^crm\./, /^sales\./, /^contracts\.contracts\.read$/, /^communication\./,
  ]);
  const financeRole = await seedRole('FINANCE_MANAGER', 'Finance Manager', [
    /^calendar\.items\.(read|create|update)$/,
    /^finance\./, /^crm\.partners\.read$/, /^contracts\.contracts\.read$/,
    /^communication\./,
  ]);
  const hrRole = await seedRole('HR_MANAGER', 'HR Manager', [
    /^calendar\.items\.(read|create|update)$/,
    /^hr\./, /^communication\./,
  ]);
  const employeeRole = await seedRole('EMPLOYEE', 'Employee (self-service)', [
    /^calendar\.items\.(read|create|update)$/,
    /^hr\.leave\.(read|create)$/, /^knowledge\.articles\.read$/,
    /^hr\.employees\.read$/, /^workflow\.tasks\.(read|approve)$/,
    /^communication\.meetings\.(read|create|update)$/,
    /^communication\.messages\.(read|create)$/,
  ]);

  // -------------------------------------------------------------- reference
  const countries = [
    { code: 'DE', name: 'Germany', nameDe: 'Deutschland', isEU: true, phoneCode: '+49' },
    { code: 'AT', name: 'Austria', nameDe: 'Österreich', isEU: true, phoneCode: '+43' },
    { code: 'CH', name: 'Switzerland', nameDe: 'Schweiz', isEU: false, phoneCode: '+41' },
    { code: 'FR', name: 'France', nameDe: 'Frankreich', isEU: true, phoneCode: '+33' },
    { code: 'NL', name: 'Netherlands', nameDe: 'Niederlande', isEU: true, phoneCode: '+31' },
  ];
  for (const c of countries) {
    await prisma.country.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  const currencies = [
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'GBP', name: 'Pound Sterling', symbol: '£' },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  const taxCodes = [
    { code: 'DE-19', name: 'Umsatzsteuer 19%', ratePercent: '19.00', datevCode: '3' },
    { code: 'DE-7', name: 'Umsatzsteuer 7%', ratePercent: '7.00', datevCode: '2' },
    { code: 'DE-0', name: 'Steuerfrei', ratePercent: '0.00', type: 'EXEMPT' },
    { code: 'DE-RC-13B', name: 'Reverse Charge §13b UStG', ratePercent: '0.00', type: 'REVERSE_CHARGE', datevCode: '94' },
    { code: 'EU-IG', name: 'Innergemeinschaftliche Lieferung', ratePercent: '0.00', type: 'INTRA_EU' },
  ];
  for (const t of taxCodes) {
    await prisma.taxCode.upsert({ where: { code: t.code }, update: {}, create: t });
  }

  const contractTypes = [
    { code: 'CLIENT_SERVICE', name: 'Client Service Contract', nameDe: 'Dienstleistungsvertrag', category: 'CLIENT' },
    { code: 'FRAMEWORK', name: 'Framework Agreement', nameDe: 'Rahmenvertrag', category: 'FRAMEWORK' },
    { code: 'SUPPLIER', name: 'Supplier Contract', nameDe: 'Lieferantenvertrag', category: 'SUPPLIER' },
    { code: 'NDA', name: 'Non-Disclosure Agreement', nameDe: 'Geheimhaltungsvereinbarung', category: 'NDA' },
    { code: 'INSURANCE', name: 'Insurance Policy', nameDe: 'Versicherungsvertrag', category: 'INSURANCE' },
  ];
  for (const ct of contractTypes) {
    await prisma.contractTypeRef.upsert({ where: { code: ct.code }, update: {}, create: ct });
  }

  if (!process.argv.includes('--demo') && process.env.OCTA_SEED_DEMO !== '1') {
    const admins = await prisma.user.count({ where: { isSystemAdmin: true, isActive: true, deletedAt: null } });
    if (!admins) {
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12) {
        throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters) to create your own first admin account. Demo data is disabled.');
      }
      const user = await prisma.user.create({ data: { email, emailNormalized: email, firstName: 'Administrator', lastName: '', isSystemAdmin: true, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), credentialUpdatedAt: new Date() } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    }
    console.log('Reference data and admin access ready. No demo companies or business records were created.');
    return;
  }

  const assetCategories = [
    { code: 'IT-NB', name: 'Notebook', depreciationYears: 3 },
    { code: 'IT-PH', name: 'Phone', depreciationYears: 3 },
    { code: 'VEH', name: 'Vehicle', depreciationYears: 6 },
    { code: 'FURN', name: 'Furniture', depreciationYears: 13 },
    { code: 'MEAS', name: 'Measuring Equipment', depreciationYears: 8, requiresCalibration: true },
  ];
  for (const ac of assetCategories) {
    await prisma.assetCategory.upsert({ where: { code: ac.code }, update: {}, create: ac });
  }

  // ----------------------------------------------------------------- company
  const company = await prisma.company.upsert({
    where: { code: 'OCTA-DE' },
    update: {},
    create: {
      code: 'OCTA-DE',
      name: 'OCTA Engineering GmbH',
      legalName: 'OCTA Engineering GmbH',
      legalForm: 'GmbH',
      vatId: 'DE123456789',
      commercialRegister: 'HRB 123456, Amtsgericht München',
      street: 'Maximilianstraße 1',
      postalCode: '80539',
      city: 'München',
      countryCode: 'DE',
      email: 'info@octa-engineering.example',
    },
  });

  const office = await prisma.office.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MUC' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'MUC',
      name: 'München HQ',
      city: 'München',
      countryCode: 'DE',
      isHQ: true,
    },
  });

  const costCenter = await prisma.costCenter.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CC-100' } },
    update: {},
    create: { companyId: company.id, code: 'CC-100', name: 'Engineering' },
  });

  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ENG' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'ENG',
      name: 'Engineering',
      costCenterId: costCenter.id,
    },
  });

  // ------------------------------------------------------------------- users
  const password = await argon2.hash('ChangeMe!2026');
  async function upsertUser(
    email: string,
    firstName: string,
    lastName: string,
    roleId: string,
    isSystemAdmin = false,
  ) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        emailNormalized: email,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        passwordHash: password,
        isSystemAdmin,
      },
    });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: {},
      create: { userId: user.id, companyId: company.id, isDefault: true },
    });
    const existing = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId, companyId: company.id },
    });
    if (!existing) {
      await prisma.userRole.create({
        data: { userId: user.id, roleId, companyId: company.id },
      });
    }
    return user;
  }

  const admin = await upsertUser('admin@octa.example', 'System', 'Admin', adminRole.id, true);
  const md = await upsertUser('md@octa.example', 'Max', 'Direktor', mdRole.id);
  const sales = await upsertUser('sales@octa.example', 'Sabine', 'Vertrieb', salesRole.id);
  await upsertUser('finance@octa.example', 'Frank', 'Finanz', financeRole.id);
  await upsertUser('hr@octa.example', 'Hanna', 'Personal', hrRole.id);
  await upsertUser('employee@octa.example', 'Emil', 'Mitarbeiter', employeeRole.id);

  // --------------------------------------------------------------- employees
  const position = await prisma.position.upsert({
    where: { code: 'SEN-ENG' },
    update: {},
    create: { code: 'SEN-ENG', name: 'Senior Engineer', level: 'SENIOR', departmentId: department.id },
  });

  const employees: Array<{ nr: string; first: string; last: string; discipline: string; userEmail?: string }> = [
    { nr: 'E-0001', first: 'Max', last: 'Direktor', discipline: 'Management', userEmail: 'md@octa.example' },
    { nr: 'E-0002', first: 'Sabine', last: 'Vertrieb', discipline: 'Business Development', userEmail: 'sales@octa.example' },
    { nr: 'E-0003', first: 'Maria', last: 'Kraus', discipline: 'Structural Engineering' },
    { nr: 'E-0004', first: 'Thomas', last: 'Schmidt', discipline: 'Electrical Engineering' },
    { nr: 'E-0005', first: 'Emil', last: 'Mitarbeiter', discipline: 'Process Engineering', userEmail: 'employee@octa.example' },
  ];
  for (const e of employees) {
    const user = e.userEmail
      ? await prisma.user.findUnique({ where: { email: e.userEmail } })
      : null;
    await prisma.employee.upsert({
      where: { companyId_employeeNumber: { companyId: company.id, employeeNumber: e.nr } },
      update: {},
      create: {
        companyId: company.id,
        officeId: office.id,
        departmentId: department.id,
        positionId: position.id,
        employeeNumber: e.nr,
        firstName: e.first,
        lastName: e.last,
        discipline: e.discipline,
        workEmail: e.userEmail ?? `${e.first.toLowerCase()}.${e.last.toLowerCase()}@octa.example`,
        status: 'ACTIVE',
        hireDate: new Date('2022-01-01'),
        weeklyHours: '40.0',
        vacationDays: '30.0',
        userId: user?.id,
      },
    });
  }

  // --------------------------------------------------------------- partners
  const partners = [
    { type: 'CLIENT' as const, nr: 'C-2026-00001', name: 'Hochtief AG', city: 'Essen', segment: 'A' },
    { type: 'CLIENT' as const, nr: 'C-2026-00002', name: 'Bayer AG', city: 'Leverkusen', segment: 'A' },
    { type: 'CLIENT' as const, nr: 'C-2026-00003', name: 'Stadtwerke München GmbH', city: 'München', segment: 'B' },
    { type: 'SUPPLIER' as const, nr: 'S-2026-00001', name: 'IT-Haus GmbH', city: 'Frankfurt', segment: null },
    { type: 'AUTHORITY' as const, nr: 'A-2026-00001', name: 'Regierung von Oberbayern', city: 'München', segment: null },
  ];
  for (const p of partners) {
    await prisma.businessPartner.upsert({
      where: { companyId_partnerNumber: { companyId: company.id, partnerNumber: p.nr } },
      update: {},
      create: {
        companyId: company.id,
        partnerNumber: p.nr,
        type: p.type,
        name: p.name,
        city: p.city,
        countryCode: 'DE',
        segment: p.segment,
        status: 'ACTIVE',
        createdById: sales.id,
      },
    });
  }

  // ------------------------------------------------- group: subsidiaries
  const countriesExtra = [
    { code: 'AE', name: 'United Arab Emirates', nameDe: 'Vereinigte Arabische Emirate', isEU: false, phoneCode: '+971' },
  ];
  for (const c of countriesExtra) {
    await prisma.country.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  // USD→EUR rate for group consolidation
  const usdRate = await prisma.exchangeRate.findFirst({
    where: { currencyCode: 'USD' },
  });
  if (!usdRate) {
    await prisma.exchangeRate.create({
      data: { currencyCode: 'USD', rateToEUR: '0.92000000', validFrom: new Date('2026-01-01') },
    });
  }
  await prisma.taxCode.upsert({
    where: { code: 'AT-20' },
    update: {},
    create: { code: 'AT-20', name: 'Umsatzsteuer 20% (AT)', ratePercent: '20.00', countryCode: 'AT' },
  });
  await prisma.taxCode.upsert({
    where: { code: 'AE-0' },
    update: {},
    create: { code: 'AE-0', name: 'Zero-rated (UAE export)', ratePercent: '0.00', countryCode: 'AE', type: 'EXEMPT' },
  });

  const subsidiaries = [
    {
      code: 'OCTA-AT',
      name: 'OCTA Engineering Austria GmbH',
      legalForm: 'GmbH',
      city: 'Wien',
      countryCode: 'AT',
      currency: 'EUR',
      locale: 'de',
      officeCode: 'VIE',
      officeName: 'Wien Office',
      employees: [
        { nr: 'AT-0001', first: 'Lukas', last: 'Steiner', discipline: 'HVAC Engineering' },
        { nr: 'AT-0002', first: 'Anna', last: 'Berger', discipline: 'Project Controls' },
      ],
      client: { nr: 'C-2026-00001', name: 'OMV AG', city: 'Wien' },
      invoice: { nr: 'R-2026-00001', net: '38500.00', tax: '7700.00', gross: '46200.00', taxCode: 'AT-20', desc: 'TGA-Planung Bürocampus Wien' },
    },
    {
      code: 'OCTA-ME',
      name: 'OCTA Engineering Middle East FZE',
      legalForm: 'FZE',
      city: 'Dubai',
      countryCode: 'AE',
      currency: 'USD',
      locale: 'en',
      officeCode: 'DXB',
      officeName: 'Dubai Office',
      employees: [
        { nr: 'ME-0001', first: 'Omar', last: 'Haddad', discipline: 'Process Engineering' },
      ],
      client: { nr: 'C-2026-00001', name: 'Emirates Global Industries LLC', city: 'Dubai' },
      invoice: { nr: 'R-2026-00001', net: '120000.00', tax: '0.00', gross: '120000.00', taxCode: 'AE-0', desc: 'FEED study desalination plant' },
    },
  ];

  for (const sub of subsidiaries) {
    const subCompany = await prisma.company.upsert({
      where: { code: sub.code },
      update: { parentCompanyId: company.id },
      create: {
        code: sub.code,
        name: sub.name,
        legalName: sub.name,
        legalForm: sub.legalForm,
        city: sub.city,
        countryCode: sub.countryCode,
        defaultCurrency: sub.currency,
        defaultLocale: sub.locale,
        parentCompanyId: company.id,
      },
    });
    const subOffice = await prisma.office.upsert({
      where: { companyId_code: { companyId: subCompany.id, code: sub.officeCode } },
      update: {},
      create: {
        companyId: subCompany.id,
        code: sub.officeCode,
        name: sub.officeName,
        city: sub.city,
        countryCode: sub.countryCode,
        isHQ: true,
      },
    });
    for (const emp of sub.employees) {
      await prisma.employee.upsert({
        where: { companyId_employeeNumber: { companyId: subCompany.id, employeeNumber: emp.nr } },
        update: {},
        create: {
          companyId: subCompany.id,
          officeId: subOffice.id,
          employeeNumber: emp.nr,
          firstName: emp.first,
          lastName: emp.last,
          discipline: emp.discipline,
          status: 'ACTIVE',
          hireDate: new Date('2024-03-01'),
        },
      });
    }
    // group leadership gets access to every subsidiary
    for (const email of ['admin@octa.example', 'md@octa.example', 'finance@octa.example']) {
      const groupUser = await prisma.user.findUnique({ where: { email } });
      if (groupUser) {
        await prisma.companyMembership.upsert({
          where: { userId_companyId: { userId: groupUser.id, companyId: subCompany.id } },
          update: {},
          create: { userId: groupUser.id, companyId: subCompany.id },
        });
        const mdRoleRef = await prisma.role.findUnique({ where: { code: 'MANAGING_DIRECTOR' } });
        if (mdRoleRef) {
          const existingRole = await prisma.userRole.findFirst({
            where: { userId: groupUser.id, roleId: mdRoleRef.id, companyId: subCompany.id },
          });
          if (!existingRole) {
            await prisma.userRole.create({
              data: { userId: groupUser.id, roleId: mdRoleRef.id, companyId: subCompany.id },
            });
          }
        }
      }
    }
    // local client + one sent invoice so group consolidation has revenue
    const subClient = await prisma.businessPartner.upsert({
      where: { companyId_partnerNumber: { companyId: subCompany.id, partnerNumber: sub.client.nr } },
      update: {},
      create: {
        companyId: subCompany.id,
        partnerNumber: sub.client.nr,
        type: 'CLIENT',
        status: 'ACTIVE',
        name: sub.client.name,
        city: sub.client.city,
        countryCode: sub.countryCode,
        currencyCode: sub.currency,
      },
    });
    // register sequences so generated numbers continue after the seeded ones
    for (const seq of [
      { entityType: 'partner:CLIENT', prefix: 'C', lastNumber: 1 },
      { entityType: 'invoice:OUTGOING', prefix: 'R', lastNumber: 1 },
    ]) {
      const existingSeq = await prisma.numberSequence.findUnique({
        where: {
          companyId_entityType_year: {
            companyId: subCompany.id,
            entityType: seq.entityType,
            year: 2026,
          },
        },
      });
      if (!existingSeq) {
        await prisma.numberSequence.create({
          data: { companyId: subCompany.id, ...seq, year: 2026 },
        });
      }
    }

    const taxRef = await prisma.taxCode.findUnique({ where: { code: sub.invoice.taxCode } });
    const existingInvoice = await prisma.invoice.findFirst({
      where: { companyId: subCompany.id, invoiceNumber: sub.invoice.nr, direction: 'OUTGOING' },
    });
    if (!existingInvoice && taxRef) {
      await prisma.invoice.create({
        data: {
          companyId: subCompany.id,
          partnerId: subClient.id,
          direction: 'OUTGOING',
          status: 'SENT',
          invoiceNumber: sub.invoice.nr,
          invoiceDate: new Date('2026-06-15'),
          serviceDate: new Date('2026-06-10'),
          dueDate: new Date('2026-07-15'),
          currencyCode: sub.currency,
          netAmount: sub.invoice.net,
          taxAmount: sub.invoice.tax,
          grossAmount: sub.invoice.gross,
          lines: {
            create: [{
              position: 1,
              description: sub.invoice.desc,
              quantity: '1',
              unit: 'LS',
              unitPrice: sub.invoice.net,
              netAmount: sub.invoice.net,
              taxCodeId: taxRef.id,
            }],
          },
        },
      });
    }
  }

  // -------------------------------------------------------- manager hierarchy
  const byNumber = async (nr: string) =>
    prisma.employee.findUnique({
      where: { companyId_employeeNumber: { companyId: company.id, employeeNumber: nr } },
    });
  const md0 = await byNumber('E-0001');
  const maria0 = await byNumber('E-0003');
  if (md0 && maria0) {
    // MD leads BD + Maria; Maria leads the two engineers
    for (const nr of ['E-0002', 'E-0003']) {
      const emp = await byNumber(nr);
      if (emp && !emp.managerId) {
        await prisma.employee.update({
          where: { id: emp.id },
          data: { managerId: md0.id },
        });
      }
    }
    for (const nr of ['E-0004', 'E-0005']) {
      const emp = await byNumber(nr);
      if (emp && !emp.managerId) {
        await prisma.employee.update({
          where: { id: emp.id },
          data: { managerId: maria0.id },
        });
      }
    }
  }

  // ---------------------------------------------------------- demo recruiting
  let opening = await prisma.jobOpening.findFirst({
    where: { companyId: company.id, title: 'Senior Electrical Engineer (m/w/d)' },
  });
  if (!opening) {
    opening = await prisma.jobOpening.create({
      data: {
        companyId: company.id,
        title: 'Senior Electrical Engineer (m/w/d)',
        departmentName: 'Engineering',
        officeName: 'München HQ',
        status: 'OPEN',
        publishedAt: new Date(),
        description: 'EMSR-Planung für Industrieanlagen, 8+ Jahre Erfahrung.',
      },
    });
    const applicants = [
      { firstName: 'Jonas', lastName: 'Weber', email: 'j.weber@example.com', source: 'LinkedIn', stage: 'NEW' },
      { firstName: 'Aylin', lastName: 'Kaya', email: 'a.kaya@example.com', source: 'StepStone', stage: 'SCREENING' },
      { firstName: 'Petra', lastName: 'Lang', email: 'p.lang@example.com', source: 'Referral', stage: 'INTERVIEW' },
    ];
    for (const a of applicants) {
      await prisma.applicant.create({
        data: { ...a, jobOpeningId: opening.id, gdprConsentDate: new Date() },
      });
    }
  }

  // ------------------------------------------------------------ bank account
  await prisma.bankAccount.upsert({
    where: { iban: 'DE02120300000000202051' },
    update: {},
    create: {
      companyId: company.id,
      name: 'Geschäftskonto DKB',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      openingBalance: '250000.00',
    },
  });

  // ------------------------------------------------- demo HR & asset data
  const allEmployees = await prisma.employee.findMany({
    where: { companyId: company.id },
  });
  for (const emp of allEmployees) {
    await prisma.leaveBalance.upsert({
      where: { employeeId_year: { employeeId: emp.id, year: 2026 } },
      update: {},
      create: {
        employeeId: emp.id,
        year: 2026,
        entitlement: '30.0',
        carryOver: '2.0',
        taken: '8.0',
      },
    });
  }

  const skillDefs = [
    { category: 'DISCIPLINE', name: 'Structural Analysis' },
    { category: 'SOFTWARE', name: 'Revit' },
    { category: 'SOFTWARE', name: 'AutoCAD' },
    { category: 'LANGUAGE', name: 'English' },
    { category: 'METHOD', name: 'HOAI / VOB' },
  ];
  const skills = [];
  for (const def of skillDefs) {
    skills.push(
      await prisma.skill.upsert({
        where: { category_name: { category: def.category, name: def.name } },
        update: {},
        create: def,
      }),
    );
  }
  const maria = allEmployees.find((e) => e.employeeNumber === 'E-0003');
  if (maria) {
    for (const [index, skill] of skills.entries()) {
      await prisma.employeeSkill.upsert({
        where: {
          employeeId_skillId: { employeeId: maria.id, skillId: skill.id },
        },
        update: {},
        create: {
          employeeId: maria.id,
          skillId: skill.id,
          level: 5 - (index % 3),
        },
      });
    }
  }

  const nbCategory = await prisma.assetCategory.findUnique({
    where: { code: 'IT-NB' },
  });
  const phoneCategory = await prisma.assetCategory.findUnique({
    where: { code: 'IT-PH' },
  });
  if (nbCategory && phoneCategory) {
    const demoAssets = [
      { nr: 'AST-2026-00001', name: 'ThinkPad P16 Gen3', categoryId: nbCategory.id, serial: 'PF-4X2K91' },
      { nr: 'AST-2026-00002', name: 'iPhone 17 Pro', categoryId: phoneCategory.id, serial: 'F2LW48XQ' },
      { nr: 'AST-2026-00003', name: 'ThinkPad T14s', categoryId: nbCategory.id, serial: 'PF-9B7D22' },
    ];
    for (const a of demoAssets) {
      await prisma.asset.upsert({
        where: {
          companyId_assetNumber: { companyId: company.id, assetNumber: a.nr },
        },
        update: {},
        create: {
          companyId: company.id,
          assetNumber: a.nr,
          name: a.name,
          categoryId: a.categoryId,
          serialNumber: a.serial,
          status: 'IN_STOCK',
          purchaseDate: new Date('2026-01-15'),
        },
      });
    }
    // assign the first notebook to Maria
    const nb = await prisma.asset.findUnique({
      where: {
        companyId_assetNumber: {
          companyId: company.id,
          assetNumber: 'AST-2026-00001',
        },
      },
    });
    if (nb && maria && nb.status === 'IN_STOCK') {
      await prisma.assetAssignment.create({
        data: { assetId: nb.id, employeeId: maria.id },
      });
      await prisma.asset.update({
        where: { id: nb.id },
        data: { status: 'ASSIGNED' },
      });
    }
  }

  // Register number sequences so generated numbers continue after the
  // hardcoded seed data instead of colliding with it.
  const sequences = [
    { entityType: 'partner:CLIENT', prefix: 'C', lastNumber: 3 },
    { entityType: 'partner:SUPPLIER', prefix: 'S', lastNumber: 1 },
    { entityType: 'partner:AUTHORITY', prefix: 'A', lastNumber: 1 },
    { entityType: 'asset', prefix: 'AST', lastNumber: 3 },
  ];
  const year = 2026;
  for (const s of sequences) {
    const existing = await prisma.numberSequence.findUnique({
      where: {
        companyId_entityType_year: {
          companyId: company.id,
          entityType: s.entityType,
          year,
        },
      },
    });
    if (!existing) {
      await prisma.numberSequence.create({
        data: {
          companyId: company.id,
          entityType: s.entityType,
          prefix: s.prefix,
          year,
          lastNumber: s.lastNumber,
        },
      });
    } else if (existing.lastNumber < s.lastNumber) {
      // never lower a live counter — that would reissue used numbers
      await prisma.numberSequence.update({
        where: { id: existing.id },
        data: { lastNumber: s.lastNumber },
      });
    }
  }

  console.log('✔ Seed complete.');
  console.log('  Login: admin@octa.example / ChangeMe!2026 (also md@, sales@, finance@, hr@, employee@)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
