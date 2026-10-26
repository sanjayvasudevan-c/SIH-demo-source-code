// Seeds the directory: regions, the officer hierarchy, Bureau, committee pool, admin, institutions,
// college users and holidays. Deterministic. Used by the demo seed and by the test suite.
import bcrypt from 'bcryptjs';
import type { PrismaClient, Role } from '@prisma/client';
import { FIRST, KINDS, LAST, SOUTH_PLACES, WEST_PLACES } from './names.js';
import { addDays, parseDateOnly, toDateOnly } from '../../src/lib/dates.js';

export interface Directory {
  regions: { SOUTH: string; WEST: string };
  byEmail: Map<string, string>;
  southOfficers: string[];
  westOfficers: string[];
  kumarTeam: string[];
  institutions: { id: string; regionId: string; portfolioOfficerId: string; collegeUserId: string; name: string }[];
}

interface UserSpec {
  name: string;
  email: string;
  role: Role;
  regionId: string | null;
  reportsToId?: string | null;
  title?: string;
  institutionId?: string;
}

const HOLIDAY_CANDIDATES: [number, number, string][] = [
  [1, 14, 'Pongal'],
  [1, 26, 'Republic Day'],
  [3, 19, 'Ugadi'],
  [4, 14, 'Ambedkar Jayanti'],
  [5, 1, 'May Day'],
  [8, 15, 'Independence Day'],
  [9, 14, 'Ganesh Chaturthi'],
  [10, 2, 'Gandhi Jayanti'],
  [10, 20, 'Dussehra'],
  [11, 9, 'Deepavali'],
  [11, 24, 'Guru Nanak Jayanti'],
  [12, 25, 'Christmas'],
];

/** Six holidays in the six months after `from`, weekdays first (placeholder dates). */
export function holidaysAfter(from: Date): { date: Date; name: string }[] {
  const start = toDateOnly(from);
  const end = addDays(start, 183);
  const all: { date: Date; name: string }[] = [];
  for (const year of [start.getUTCFullYear(), start.getUTCFullYear() + 1]) {
    for (const [m, d, name] of HOLIDAY_CANDIDATES) {
      const date = parseDateOnly(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      if (date > start && date <= end) all.push({ date, name });
    }
  }
  const weekday = all.filter((h) => h.date.getUTCDay() !== 0 && h.date.getUTCDay() !== 6);
  const weekend = all.filter((h) => !weekday.includes(h));
  return [...weekday, ...weekend].slice(0, 6).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Institution facts used by purview and schedule expressions, from the (fictional) name. */
export function institutionKind(name: string): { kind: string; isTechnical: boolean } {
  if (name.endsWith('Polytechnic College')) return { kind: 'POLYTECHNIC', isTechnical: true };
  if (name.endsWith('Institute of Management Studies')) return { kind: 'MANAGEMENT_INSTITUTE', isTechnical: true };
  if (name.endsWith('School of Architecture')) return { kind: 'ARCHITECTURE_SCHOOL', isTechnical: true };
  if (name.endsWith('College of Pharmacy')) return { kind: 'PHARMACY_COLLEGE', isTechnical: true };
  if (name.endsWith('College of Computer Applications')) return { kind: 'ARTS_SCIENCE_COLLEGE', isTechnical: false };
  return { kind: 'ENGINEERING_COLLEGE', isTechnical: true };
}

function permanentId(n: number): string {
  // AICTE-style permanent IDs: 1-XXXXXXXXXX (fictional, deterministic).
  return `1-${String(4400000000 + n * 7919).padStart(10, '0')}`;
}

export async function seedDirectory(db: PrismaClient, opts: { today: Date }): Promise<Directory> {
  const passwordHash = bcrypt.hashSync('demo1234', 10);
  const byEmail = new Map<string, string>();
  let nameIdx = 0;
  const usedEmails = new Set<string>();

  const nextName = () => {
    const first = FIRST[nameIdx % FIRST.length];
    const last = LAST[(nameIdx * 7 + Math.floor(nameIdx / FIRST.length)) % LAST.length];
    nameIdx++;
    return `${first} ${last}`;
  };
  const emailFor = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
    let e = `${base}@demo.in`;
    let i = 2;
    while (usedEmails.has(e)) e = `${base}${i++}@demo.in`;
    return e;
  };

  async function user(spec: UserSpec): Promise<string> {
    usedEmails.add(spec.email);
    const u = await db.user.create({
      data: {
        name: spec.name,
        email: spec.email,
        passwordHash,
        role: spec.role,
        regionId: spec.regionId,
        reportsToId: spec.reportsToId ?? null,
        title: spec.title ?? null,
        institutionId: spec.institutionId ?? null,
      },
    });
    byEmail.set(spec.email, u.id);
    return u.id;
  }

  async function profile(userId: string, homeRegionId: string | null, capacity = 10, skills: string[] = []) {
    await db.officerProfile.create({
      data: { userId, homeRegionId, capacityPoints: capacity, maxUtil: 1.0, skills, barredInstitutionIds: [] },
    });
  }

  const south = await db.region.create({ data: { code: 'SOUTH', name: 'Southern Region' } });
  const west = await db.region.create({ data: { code: 'WEST', name: 'Western Region' } });
  await db.simClock.upsert({ where: { id: 1 }, create: { id: 1, offsetDays: 0 }, update: { offsetDays: 0 } });

  // ---- South hierarchy ----
  const hodSouth = await user({ name: 'Dr. Rajesh Menon', email: 'hod.south@demo.in', role: 'HOD', regionId: south.id, title: 'Head of Department' });
  const lakshmi = await user({ name: 'Lakshmi Iyer', email: 'lakshmi@demo.in', role: 'SUPER_SENIOR', regionId: south.id, reportsToId: hodSouth, title: 'Deputy Director' });
  const ss2 = await user({ name: 'Venkatesh Subramanian', email: 'venkatesh@demo.in', role: 'SUPER_SENIOR', regionId: south.id, reportsToId: hodSouth, title: 'Deputy Director' });
  await user({ name: 'Dr. S. Balasubramanian', email: 'authority.south@demo.in', role: 'AUTHORITY', regionId: south.id, title: 'Regional Director (competent authority)' });

  const southSeniors: string[] = [];
  const kumar = await user({ name: 'Kumar Sharma', email: 'kumar@demo.in', role: 'SENIOR', regionId: south.id, reportsToId: lakshmi, title: 'Assistant Director' });
  southSeniors.push(kumar);
  for (let i = 0; i < 9; i++) {
    const name = nextName();
    southSeniors.push(
      await user({ name, email: emailFor(name), role: 'SENIOR', regionId: south.id, reportsToId: i < 4 ? lakshmi : ss2, title: 'Assistant Director' }),
    );
  }

  const southOfficers: string[] = [];
  const kumarTeamSpecs: [string, string, number, string[]][] = [
    ['Priya Raman', 'priya@demo.in', 10, []],
    ['Arjun Rao', 'arjun@demo.in', 10, []],
    ['Meena Pillai', 'meena@demo.in', 10, []],
    ['Ravi Kumar', 'ravi@demo.in', 20, ['EVC_DESK']],
    ['Sneha Nair', 'sneha@demo.in', 10, []],
  ];
  const kumarTeam: string[] = [];
  for (const [name, email, cap, skills] of kumarTeamSpecs) {
    const id = await user({ name, email, role: 'OFFICER', regionId: south.id, reportsToId: kumar, title: 'Section Officer' });
    await profile(id, south.id, cap, skills);
    kumarTeam.push(id);
    southOfficers.push(id);
  }
  for (const senior of southSeniors.slice(1)) {
    for (let i = 0; i < 5; i++) {
      const name = nextName();
      const id = await user({ name, email: emailFor(name), role: 'OFFICER', regionId: south.id, reportsToId: senior, title: 'Section Officer' });
      await profile(id, south.id);
      southOfficers.push(id);
    }
  }

  // ---- West hierarchy ----
  const hodWest = await user({ name: 'Dr. Anil Deshpande', email: 'hod.west@demo.in', role: 'HOD', regionId: west.id, title: 'Head of Department' });
  const ssWest = await user({ name: 'Sunita Kulkarni', email: 'sunita@demo.in', role: 'SUPER_SENIOR', regionId: west.id, reportsToId: hodWest, title: 'Deputy Director' });
  await user({ name: 'Dr. Vijay Gokhale', email: 'authority.west@demo.in', role: 'AUTHORITY', regionId: west.id, title: 'Regional Director (competent authority)' });
  const westSeniors = [
    await user({ name: 'Mahesh Jadhav', email: 'mahesh@demo.in', role: 'SENIOR', regionId: west.id, reportsToId: ssWest, title: 'Assistant Director' }),
    await user({ name: 'Smita Bhosale', email: 'smita@demo.in', role: 'SENIOR', regionId: west.id, reportsToId: ssWest, title: 'Assistant Director' }),
  ];
  const westOfficerSpecs: [string, string, number, string[]][] = [
    ['Rahul Patil', 'officer.west@demo.in', 10, []],
    ['Neha Joshi', 'neha@demo.in', 20, ['EVC_DESK']],
    ['Amit Shinde', 'amit@demo.in', 10, []],
    ['Pallavi Pawar', 'pallavi@demo.in', 10, []],
    ['Sachin More', 'sachin@demo.in', 10, []],
    ['Kavya Desai', 'kavya@demo.in', 10, []],
  ];
  const westOfficers: string[] = [];
  for (let i = 0; i < westOfficerSpecs.length; i++) {
    const [name, email, cap, skills] = westOfficerSpecs[i];
    const id = await user({ name, email, role: 'OFFICER', regionId: west.id, reportsToId: westSeniors[i < 3 ? 0 : 1], title: 'Section Officer' });
    await profile(id, west.id, cap, skills);
    westOfficers.push(id);
  }

  // ---- Bureau (cross-region) ----
  const bureauHead = await user({ name: 'Dr. Meera Krishnan', email: 'bureau.head@demo.in', role: 'BUREAU', regionId: null, title: 'Bureau Head' });
  await profile(bureauHead, null);
  for (const [name, email] of [
    ['Farhan Qureshi', 'bureau1@demo.in'],
    ['Geetha Raghavan', 'bureau2@demo.in'],
  ]) {
    const id = await user({ name, email, role: 'BUREAU', regionId: null, reportsToId: bureauHead, title: 'Bureau Officer' });
    await profile(id, null);
  }

  // ---- Committee pool (cross-region) ----
  const committeeNames = ['Prof. N. Raghunathan', 'Dr. Shobha Hegde', 'Prof. Imran Sheikh', 'Dr. Usha Rani', 'Prof. Devendra Tiwari', 'Dr. Asha Varghese'];
  for (let i = 0; i < committeeNames.length; i++) {
    const id = await user({ name: committeeNames[i], email: `committee${i + 1}@demo.in`, role: 'COMMITTEE', regionId: null, title: 'Expert committee member' });
    await profile(id, null);
  }

  await user({ name: 'System Administrator', email: 'admin@demo.in', role: 'ADMIN', regionId: null, title: 'Administrator' });
  await user({ name: 'Ravi Narayanan', email: 'rules.editor@demo.in', role: 'RULE_EDITOR', regionId: null, title: 'Deputy Director, Regulation Bureau' });
  await user({ name: 'Dr. Kavita Rao', email: 'rules.approver@demo.in', role: 'RULE_APPROVER', regionId: null, title: 'Director, Regulation Bureau' });

  // ---- Institutions and college users ----
  const institutions: Directory['institutions'] = [];
  let instNo = 0;
  async function institution(name: string, regionId: string, portfolioOfficerId: string, collegeEmail?: string) {
    instNo++;
    const inst = await db.institution.create({
      data: { permanentId: permanentId(instNo), name, regionId, portfolioOfficerId, ...institutionKind(name) },
    });
    const email = collegeEmail ?? `college.${String(instNo).padStart(3, '0')}@demo.in`;
    const collegeUserId = await user({ name: `${name} (nodal officer)`, email, role: 'COLLEGE', regionId, institutionId: inst.id, title: 'Nodal officer' });
    institutions.push({ id: inst.id, regionId, portfolioOfficerId, collegeUserId, name });
    return inst.id;
  }

  // ABC Engineering College is Priya's first portfolio institution.
  await institution('ABC Engineering College', south.id, kumarTeam[0], 'college.abc@demo.in');
  let p = 0;
  for (let i = 0; i < southOfficers.length; i++) {
    const count = i === 0 ? 1 : 2;
    for (let k = 0; k < count; k++) {
      const name = `${SOUTH_PLACES[p % SOUTH_PLACES.length]} ${KINDS[p % KINDS.length]}`;
      p++;
      await institution(name, south.id, southOfficers[i]);
    }
  }
  for (let i = 0; i < 20; i++) {
    const name = `${WEST_PLACES[i]} ${KINDS[(i + 3) % KINDS.length]}`;
    await institution(name, west.id, westOfficers[i % westOfficers.length]);
  }

  for (const h of holidaysAfter(opts.today)) {
    await db.holiday.create({ data: { date: h.date, name: h.name } });
  }

  return {
    regions: { SOUTH: south.id, WEST: west.id },
    byEmail,
    southOfficers,
    westOfficers,
    kumarTeam,
    institutions,
  };
}
