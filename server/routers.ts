import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import type { User } from "../drizzle/schema";
import { outcomeTypeEnum } from "../drizzle/schema";
import {
  DatabaseNotConfiguredError,
  InputValidationError,
  NotFoundError,
  createCertificateShareLink,
  createEmployeeLink,
  createVerificationLink,
  deleteEmployeeDocument,
  employeeDocumentUrl,
  getConsentStatus,
  getCohortPerformance,
  getDashboardSummary,
  getEmployeePortal,
  getPublicCertificate,
  getTraineeJourney,
  listEmployeeDocuments,
  listFollowUpQueue,
  listRecentMessageJobs,
  listSkillGaps,
  listTrainees,
  sendManualOutreach,
  submitEmployerVerification,
  submitTraineeResponse,
  uploadEmployeeDocument,
  withdrawConsent,
} from "./queries";
import {
  buildSkillGaps,
  toCohortPerformance,
  toDashboardMetrics,
  toDistrictPerformance,
  toFollowUpCase,
  toMessageActivity,
  toOutcomeMix,
  toRetentionSeries,
  toTraineeListItem,
  toWageSeries,
} from "./mappers";

// Staff procedures require a signed-in user (401 redirects to /login on the
// client). Trainee- and employer-facing surfaces stay public: the mobile
// follow-up wizard and the token-gated employer verification form.
const staffProcedure = protectedProcedure;

/**
 * District scope policy: admins and unscoped staff see everything; a staff
 * user with a district sees only that district's operational data.
 */
export function districtScope(user: User | null): string | null {
  if (!user || user.role === "admin") return null;
  return user.district ?? null;
}

async function runDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Database is not configured (DATABASE_URL is missing)",
      });
    }
    if (error instanceof NotFoundError) {
      throw new TRPCError({ code: "NOT_FOUND", message: error.message });
    }
    if (error instanceof InputValidationError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  outcomes: router({
    summary: staffProcedure.query(({ ctx }) =>
      runDb(async () => {
        const scope = districtScope(ctx.user);
        const summary = await getDashboardSummary();
        return {
          metrics: toDashboardMetrics(summary),
          districts: toDistrictPerformance(
            scope ? summary.districts.filter((row) => row.district === scope) : summary.districts
          ),
          outcomeMix: toOutcomeMix(summary.outcomeMix),
          retentionSeries: toRetentionSeries(summary.retentionSeries),
          wageSeries: toWageSeries(summary.wageSeries),
        };
      })
    ),
    cohorts: staffProcedure.query(({ ctx }) =>
      runDb(async () => {
        const scope = districtScope(ctx.user);
        const rows = toCohortPerformance(await getCohortPerformance());
        return scope ? rows.filter((row) => row.district === scope) : rows;
      })
    ),
    skillGaps: staffProcedure.query(() => runDb(async () => buildSkillGaps(await listSkillGaps()))),
    trainees: staffProcedure
      .input(z.object({ district: z.string().optional(), query: z.string().optional() }).optional())
      .query(({ input, ctx }) =>
        runDb(async () => {
          const scope = districtScope(ctx.user);
          const requested = input?.district && input.district !== "All districts" ? input.district : null;
          // A scoped counsellor can never widen the view beyond their district.
          const effective = scope ?? requested;
          const rows = await listTrainees({
            district: effective ?? undefined,
            query: input?.query,
          });
          return rows.map((row) => toTraineeListItem(row));
        })
      ),
    // Public read-by-slug: the trainee-facing mobile wizard greets through it.
    // Full token-gating of the mobile surface is the next privacy milestone.
    traineeJourney: publicProcedure
      .input(z.object({ id: z.string().min(1) }))
      .query(({ input }) =>
        runDb(async () => {
          const journey = await getTraineeJourney(input.id);
          return {
            trainee: toTraineeListItem(journey.trainee),
            timeline: journey.timeline,
          };
        })
      ),
  }),
  followUps: router({
    queue: staffProcedure.query(({ ctx }) =>
      runDb(async () => {
        const scope = districtScope(ctx.user);
        const rows = await listFollowUpQueue();
        return rows
          .filter((row) => !scope || row.district === scope)
          .map((row) => toFollowUpCase(row));
      })
    ),
    activity: staffProcedure.query(() =>
      runDb(async () => toMessageActivity(await listRecentMessageJobs()))
    ),
    sendMessage: staffProcedure
      .input(z.object({ caseId: z.string().min(1), channel: z.enum(["WhatsApp", "SMS", "Call"]) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const caseId = Number.parseInt(input.caseId.replace(/^case-/, ""), 10);
          if (!Number.isFinite(caseId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid caseId: ${input.caseId}` });
          }
          const result = await sendManualOutreach({
            caseId,
            channel: input.channel.toLowerCase() as "whatsapp" | "sms" | "call",
          });
          return {
            accepted: true,
            caseId: input.caseId,
            channel: input.channel,
            providerMessageId: result.providerMessageId,
            duplicate: result.duplicate,
          };
        })
      ),
    submitResponse: staffProcedure
      .input(
        z.object({
          traineeId: z.string().min(1),
          outcomeType: z.enum(outcomeTypeEnum.enumValues),
          wageBand: z.string().optional(),
          relevance: z.number().min(1).max(5).optional(),
          consentToContact: z.boolean(),
        })
      )
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await submitTraineeResponse({
            slug: input.traineeId,
            outcomeType: input.outcomeType,
            wageBand: input.wageBand ?? null,
            relevance: input.relevance ?? null,
            consentToContact: input.consentToContact,
          });
          return { accepted: true, ...result };
        })
      ),
  }),
  consent: router({
    status: staffProcedure
      .input(z.object({ traineeId: z.string().min(1) }))
      .query(({ input }) =>
        runDb(async () => {
          const { trainee, grants } = await getConsentStatus(input.traineeId);
          return {
            traineeId: trainee.slug,
            purposes: grants.map((grant) => ({
              purposeCode: grant.purposeCode,
              status: grant.status,
              expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
            })),
          };
        })
      ),
    withdraw: staffProcedure
      .input(z.object({ traineeId: z.string().min(1), purposeCode: z.string().min(1) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await withdrawConsent({
            slug: input.traineeId,
            purposeCode: input.purposeCode,
          });
          return {
            accepted: true,
            traineeId: input.traineeId,
            purposeCode: input.purposeCode,
            cancelledFutureTasks: result.cancelledTaskCount > 0,
            auditEventId: result.auditEventId,
          };
        })
      ),
  }),
  verification: router({
    // Issues a single-use link for the public verification surface. The
    // provider-signed delivery of this link arrives with Phase 4 messaging.
    createLink: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const link = await createVerificationLink({ traineeRef: input.traineeRef });
          return { accepted: true, ...link };
        })
      ),
    submit: publicProcedure
      .input(
        z.object({
          token: z.string().min(1),
          stillEmployed: z.boolean(),
          roleCategory: z.string().optional(),
          wageBand: z.string().optional(),
        })
      )
      .mutation(({ input }) =>
        runDb(
          async () =>
            await submitEmployerVerification({
              token: input.token,
              stillEmployed: input.stillEmployed,
              roleCategory: input.roleCategory ?? null,
              wageBand: input.wageBand ?? null,
            })
        )
      ),
  }),
  employee: router({
    // Staff issue a passwordless portal link to a placed trainee.
    createLink: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const link = await createEmployeeLink({ traineeRef: input.traineeRef });
          return { accepted: true, ...link };
        })
      ),
    // Token-gated: the portal link itself is the session (30-day signed JWT).
    // Token travels as input so the staff Bearer header never collides with it.
    me: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .query(({ input }) => runDb(async () => getEmployeePortal({ token: input.token }))),
    documents: router({
      list: publicProcedure
        .input(z.object({ token: z.string().min(1) }))
        .query(({ input }) => runDb(async () => listEmployeeDocuments({ token: input.token }))),
      upload: publicProcedure
        .input(
          z.object({
            token: z.string().min(1),
            kind: z.enum(["certificate", "payslip", "id_document", "other"]),
            title: z.string().min(1).max(160),
            fileName: z.string().min(1).max(160),
            mimeType: z.string().min(3).max(96),
            dataBase64: z.string().min(1),
          })
        )
        .mutation(({ input }) => runDb(async () => uploadEmployeeDocument(input))),
      url: publicProcedure
        .input(z.object({ token: z.string().min(1), documentId: z.number().int().positive() }))
        .query(({ input }) => runDb(async () => employeeDocumentUrl(input))),
      delete: publicProcedure
        .input(z.object({ token: z.string().min(1), documentId: z.number().int().positive() }))
        .mutation(({ input }) => runDb(async () => deleteEmployeeDocument(input))),
    }),
    certificates: router({
      // Employee shares one of their completed courses; the link is public.
      createShareLink: publicProcedure
        .input(z.object({ token: z.string().min(1), trainingRecordId: z.number().int().positive() }))
        .mutation(({ input }) => runDb(async () => createCertificateShareLink(input))),
      view: publicProcedure
        .input(z.object({ token: z.string().min(1) }))
        .query(({ input }) => runDb(async () => getPublicCertificate({ token: input.token }))),
    }),
  }),
});

export type AppRouter = typeof appRouter;
