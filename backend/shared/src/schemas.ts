import { z } from 'zod';
import { APPLICATION_TYPES, PERMISSIONS, QUESTION_TYPES, ROLES, ROUND_DECISIONS } from './constants';

const email = z.string().email().max(255).toLowerCase();
const name = z.string().trim().min(1).max(100);
const password = z.string().min(8).max(200);

export const registerSchema = z
  .object({
    firstName: name,
    lastName: name,
    email,
    password,
    phone: z.string().max(30).optional(),
    role: z.enum(['candidate', 'mentor', 'company']),
    companyName: z.string().trim().min(2).max(200).optional(),
  })
  .refine((v) => v.role !== 'company' || !!v.companyName, {
    message: 'Company name is required for company accounts',
    path: ['companyName'],
  });

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

export const kycSchema = z.object({
  provider: z.string().min(2).max(50),
  providerRef: z.string().min(2).max(255),
  consent: z.literal(true),
});

export const createAdminSchema = z.object({
  firstName: name,
  lastName: name,
  email,
  password,
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

export const permissionUpdateSchema = z.object({
  grants: z.array(
    z.object({ permissionKey: z.enum(PERMISSIONS), effect: z.enum(['allow', 'deny']) }),
  ),
});

export const settingSchema = z.object({ value: z.unknown() });

export const profileSchema = z.object({
  professionalTitle: z.string().max(150).nullish(),
  totalExperienceYears: z.number().min(0).max(70).nullish(),
  location: z.string().max(150).nullish(),
  education: z.string().max(2000).nullish(),
  bio: z.string().max(5000).nullish(),
  availability: z.string().max(40).nullish(),
  isDiscoverable: z.boolean().optional(),
  skills: z
    .array(
      z.object({
        skillName: z.string().trim().min(1).max(100),
        experienceYears: z.number().min(0).max(70).nullish(),
        proficiency: z.string().max(30).nullish(),
      }),
    )
    .optional(),
});

export const applicationSchema = z.object({
  applicationType: z.enum(APPLICATION_TYPES),
  jobRoleId: z.number().int().positive().nullish(),
  resumeId: z.number().int().positive().nullish(),
});

export const reviewApplicationSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNotes: z.string().max(4000).nullish(),
  extractedExperience: z.number().min(0).max(70).nullish(),
  mentorId: z.string().uuid().nullish(),
  routeTo: z.enum(['candidate', 'mentor']).nullish(),
  force: z.boolean().default(false),
});

export const questionSchema = z.object({
  questionKey: z.string().trim().min(1).max(100),
  questionText: z.string().trim().min(1).max(10000),
  questionType: z.enum(QUESTION_TYPES),
  options: z.array(z.string().max(500)).max(50).nullish(),
  answerKey: z.string().max(10000).nullish(),
  marks: z.number().min(0).max(1000),
  sequenceOrder: z.number().int().min(0).default(0),
});

export const snapshotSchema = z.object({
  title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(1).max(600).default(30),
  levels: z
    .array(
      z.object({
        levelNumber: z.number().int().min(1),
        title: z.string().max(200).nullish(),
        questions: z.array(questionSchema).min(1),
      }),
    )
    .min(1),
});

export type Question = z.infer<typeof questionSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export const templateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  snapshot: snapshotSchema,
});

export const roundSchema = z.object({
  mentorAssignmentId: z.number().int().positive(),
  templateId: z.number().int().positive(),
  scheduledAt: z.string().datetime().nullish(),
});

export const attemptAnswerSchema = z.object({
  questionId: z.number().int().positive(),
  answer: z.unknown(),
});

export const submitAttemptSchema = z.object({
  answers: z.array(attemptAnswerSchema).max(500),
});

export const eventSchema = z.object({
  eventType: z.string().min(1).max(50),
  eventDetails: z.record(z.unknown()).optional(),
});

export const evaluateSchema = z.object({
  scores: z.array(
    z.object({
      questionId: z.number().int().positive(),
      mentorScore: z.number().min(0).nullable(),
      feedback: z.string().max(4000).nullish(),
    }),
  ),
  mentorFeedback: z.string().max(4000).nullish(),
  status: z.enum(['submitted', 'evaluated']).default('evaluated'),
});

export const decisionSchema = z.object({
  decision: z.enum(ROUND_DECISIONS),
  remarks: z.string().max(4000).nullish(),
  nextAssessmentAt: z.string().datetime().nullish(),
});

export const introductionRequestSchema = z.object({
  candidateRef: z.string().uuid(),
  message: z.string().trim().min(10).max(2000),
});

export const introductionResponseSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

export const searchQuerySchema = z.object({
  q: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  skill: z.string().max(100).optional(),
  minExperience: z.coerce.number().min(0).max(70).optional(),
  minScore: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const roleSchema = z.enum(ROLES);

export type ApiUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: { role: string; isActive: boolean }[];
  permissions: string[];
  companyId: number | null;
  kycVerified: boolean;
};
