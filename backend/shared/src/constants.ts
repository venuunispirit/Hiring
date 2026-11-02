export const ROLES = ['super_admin', 'admin', 'mentor', 'candidate', 'company'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'users.create_admin',
  'users.list',
  'permissions.manage',
  'settings.manage',
  'audit.view',
  'applications.view',
  'applications.review',
  'mentors.assign',
  'candidates.view',
  'assessments.manage',
  'assessments.monitor',
  'assessments.evaluate',
  'profile.manage',
  'applications.apply',
  'assessments.attempt',
  'introductions.respond',
  'notifications.view',
  'candidates.search',
  'introductions.request',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [...PERMISSIONS],
  admin: [
    'users.list',
    'audit.view',
    'applications.view',
    'applications.review',
    'mentors.assign',
    'notifications.view',
  ],
  mentor: [
    'candidates.view',
    'assessments.manage',
    'assessments.monitor',
    'assessments.evaluate',
    'notifications.view',
  ],
  candidate: [
    'profile.manage',
    'applications.apply',
    'assessments.attempt',
    'introductions.respond',
    'notifications.view',
  ],
  company: ['candidates.search', 'introductions.request', 'notifications.view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  mentor: 'Mentor',
  candidate: 'Candidate',
  company: 'Company',
};

export const APPLICATION_TYPES = ['candidate', 'mentor'] as const;
export const QUESTION_TYPES = [
  'mcq',
  'multiple_select',
  'true_false',
  'short_answer',
  'descriptive',
  'coding',
  'practical',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  multiple_select: 'Multiple select',
  true_false: 'True / false',
  short_answer: 'Short answer',
  descriptive: 'Descriptive',
  coding: 'Coding',
  practical: 'Practical',
};

export const ROUND_DECISIONS = ['proceed', 'reject', 'hold', 'reschedule'] as const;
export const MENTOR_EXPERIENCE_THRESHOLD_KEY = 'mentor_experience_threshold';

// Common free-mail domains blocked for company sign-ups.
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
]);
