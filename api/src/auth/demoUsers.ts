// Named demo logins shown on the login picker (only when DEMO_MODE=true) and printed by the seed.
export const NAMED_DEMO_EMAILS = [
  'college.abc@demo.in',
  'priya@demo.in',
  'arjun@demo.in',
  'meena@demo.in',
  'ravi@demo.in',
  'kumar@demo.in',
  'lakshmi@demo.in',
  'hod.south@demo.in',
  'authority.south@demo.in',
  'committee1@demo.in',
  'committee2@demo.in',
  'committee3@demo.in',
  'committee4@demo.in',
  'committee5@demo.in',
  'committee6@demo.in',
  'bureau.head@demo.in',
  'officer.west@demo.in',
  'admin@demo.in',
  'rules.editor@demo.in',
  'rules.approver@demo.in',
] as const;

export const DEMO_PASSWORD = 'demo1234';

export function demoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}
