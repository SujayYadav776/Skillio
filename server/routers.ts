import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, rateLimited, router } from "./_core/trpc";
import type { User } from "../drizzle/schema";
import { outcomeTypeEnum } from "../drizzle/schema";
import {
  DatabaseNotConfiguredError,
  InputValidationError,
  NotFoundError,
  createCertificateShareLink,
  createEmployeeLink,
  createTraineePulseLink,
  createVerificationLink,
  deleteEmployeeDocument,
  employeeDocumentUrl,
  escalateTrainee,
  getConsentStatus,
  getCohortPerformance,
  getDashboardSummary,
  getEmployeePortal,
  getPublicCertificate,
  getRiskWatchlist,
  getTraineeJourney,
  getTraineePulse,
  listEmployeeDocuments,
  listFollowUpQueue,
  listProviderScorecards,
  listRecentMessageJobs,
  listSkillGaps,
  listTrainees,
  sendManualOutreach,
  submitEmployerVerification,
  submitTraineePulseResponse,
  submitTraineeResponse,
  uploadEmployeeDocument,
  withdrawConsent,
} from "./queries";
import {
  buildEvidenceSummary,
  buildSkillGaps,
  nextBestActionFor,
  toCohortPerformance,
  toDashboardMetrics,
  toDistrictPerformance,
  toFollowUpCase,
  toMessageActivity,
  toOutcomeMix,
  toProviderScorecard,
  toRetentionSeries,
  toTraineeListItem,
  toWageSeries,
} from "./mappers";
import {
  createPassportShare,
  getEmployeePassport,
  getPublicPassport,
  publishPassport,
  revokePassportForTrainee,
  revokePassportOnConsentWithdrawal,
  revokePassportShare,
  verifyPassportIntegrity,
} from "./passport";
import {
  applyToPosting,
  confirmPlacement,
  createPosting,
  getPlacementBoard,
  listApplications,
  listEmployeeMatches,
  listEmployers,
  listPostings,
  referToPosting,
} from "./exchange";
import {
  applyForBenefit,
  createBenefitScheme,
  listBenefitClaims,
  listBenefitSchemes,
  listEmployeeBenefits,
  setBenefitStatus,
} from "./benefits";
import {
  assignCase,
  getCaseThread,
  getEmployeeCase,
  listEmployeeCases,
  listOpenCases,
  openGrievance,
  postEmployeeReply,
  postStaffReply,
  resolveCase,
} from "./grievances";

// Staff procedures require a signed-in user (401 redirects to /login on the
// client). Trainee-, employer- and employee-facing surfaces are reachable only
// with a signed capability link.
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
      // A bad capability link is indistinguishable from a missing record, by
      // design: probing for valid links must not be rewarded with information.
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
    // Staff journey view: full operational record plus the evidence readout and
    // the rule-based recommendation the page renders.
    traineeJourney: staffProcedure
      .input(z.object({ id: z.string().min(1) }))
      .query(({ input, ctx }) =>
        runDb(async () => {
          const journey = await getTraineeJourney(input.id);
          const scope = districtScope(ctx.user);
          if (scope && journey.trainee.district !== scope) {
            // A district-scoped counsellor must not read another district's record.
            throw new NotFoundError("Trainee", input.id);
          }
          const trainee = toTraineeListItem(journey.trainee);
          const evidence = buildEvidenceSummary({
            outcomeStatus: journey.trainee.outcomeStatus,
            lastUpdated: journey.trainee.lastUpdated,
            outcomeEvents: journey.outcomeEvents.map((event) => ({
              outcomeType: event.outcomeType,
              outcomeStatus: journey.trainee.outcomeStatus,
              evidenceConfidence: event.evidenceConfidence,
              source: event.source,
              supersedesEventId: event.supersedesEventId,
            })),
          });
          const nextBestAction = nextBestActionFor({
            outcomeType: journey.trainee.outcomeType,
            outcomeStatus: journey.trainee.outcomeStatus,
            barrier: journey.trainee.barrier,
            relevance: journey.trainee.relevance,
            retentionDays: journey.trainee.retentionDays,
            hasOpenCase: journey.counsellorCases.some((item) =>
              ["open", "assigned"].includes(item.status)
            ),
          });
          return {
            trainee,
            timeline: journey.timeline,
            evidence,
            nextBestAction,
            consent: journey.consentGrants.map((grant) => ({
              purposeCode: grant.purposeCode,
              status: grant.status,
              expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
              noticeVersion: grant.noticeVersion,
            })),
            openCases: journey.counsellorCases.filter((item) =>
              ["open", "assigned"].includes(item.status)
            ).length,
          };
        })
      ),
    // Trainee-facing read: reachable only with a signed pulse link, so the
    // register can no longer be enumerated by slug.
    traineePulse: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .query(({ input }) =>
        runDb(async () => {
          const trainee = await getTraineePulse({ token: input.token });
          return { trainee: toTraineeListItem(trainee) };
        })
      ),
    // Explainable attrition-risk watchlist.
    watchlist: staffProcedure.query(({ ctx }) =>
      runDb(async () => {
        const scope = districtScope(ctx.user);
        const rows = await getRiskWatchlist();
        return rows
          .filter((row) => !scope || row.trainee.district === scope)
          .slice(0, 25)
          .map((row) => ({
            trainee: toTraineeListItem(row.trainee),
            score: row.score,
            level: row.level,
            flags: row.flags,
          }));
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
            failed: "failed" in result ? (result.failed ?? null) : null,
          };
        })
      ),
    // Staff-only fallback used by the desktop journey page.
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
    // Public pulse submission — authorised by the signed link, not a slug.
    submitPulseResponse: rateLimited({ windowMs: 60_000, max: 20 })
      .input(
        z.object({
          token: z.string().min(1),
          outcomeType: z.enum(outcomeTypeEnum.enumValues),
          wageBand: z.string().optional(),
          relevance: z.number().min(1).max(5).optional(),
          consentToContact: z.boolean(),
        })
      )
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await submitTraineePulseResponse({
            token: input.token,
            outcomeType: input.outcomeType,
            wageBand: input.wageBand ?? null,
            relevance: input.relevance ?? null,
            consentToContact: input.consentToContact,
          });
          return { accepted: true, ...result };
        })
      ),
    createPulseLink: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1), ttlDays: z.number().int().min(1).max(90).optional() }))
      .mutation(({ input }) =>
        runDb(async () => {
          const link = await createTraineePulseLink({
            traineeRef: input.traineeRef,
            ttlDays: input.ttlDays,
          });
          return { accepted: true, ...link };
        })
      ),
    escalate: staffProcedure
      .input(
        z.object({
          traineeRef: z.string().min(1),
          priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
          reason: z.string().max(400).optional(),
        })
      )
      .mutation(({ input, ctx }) =>
        runDb(async () => {
          const result = await escalateTrainee({
            traineeRef: input.traineeRef,
            priority: input.priority,
            reason: input.reason,
            assignedTo: ctx.user?.name ?? null,
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
          // A passport only exists to be shared publicly, so withdrawing the
          // consent that authorised it revokes the document and its links.
          const passport = await revokePassportOnConsentWithdrawal(
            result.traineeId,
            input.purposeCode
          );
          return {
            accepted: true,
            traineeId: input.traineeId,
            purposeCode: input.purposeCode,
            cancelledFutureTasks: result.cancelledTaskCount > 0,
            auditEventId: result.auditEventId,
            passportRevoked: passport.revoked,
          };
        })
      ),
  }),
  verification: router({
    createLink: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const link = await createVerificationLink({ traineeRef: input.traineeRef });
          return { accepted: true, ...link };
        })
      ),
    submit: rateLimited({ windowMs: 60_000, max: 20 })
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
    createLink: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const link = await createEmployeeLink({ traineeRef: input.traineeRef });
          return { accepted: true, ...link };
        })
      ),
    me: rateLimited({ windowMs: 60_000, max: 30 })
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
      // A mutation, not a query: each call mints a fresh 5-minute capability
      // URL, so it must never be cached by the query client.
      url: publicProcedure
        .input(z.object({ token: z.string().min(1), documentId: z.number().int().positive() }))
        .mutation(({ input }) => runDb(async () => employeeDocumentUrl(input))),
      delete: publicProcedure
        .input(z.object({ token: z.string().min(1), documentId: z.number().int().positive() }))
        .mutation(({ input }) => runDb(async () => deleteEmployeeDocument(input))),
    }),
    certificates: router({
      createShareLink: publicProcedure
        .input(z.object({ token: z.string().min(1), trainingRecordId: z.number().int().positive() }))
        .mutation(({ input }) => runDb(async () => createCertificateShareLink(input))),
      view: publicProcedure
        .input(z.object({ token: z.string().min(1) }))
        .query(({ input }) => runDb(async () => getPublicCertificate({ token: input.token }))),
    }),
  }),
  passport: router({
    // Employee-facing: the portal link is the session.
    me: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .query(({ input }) => runDb(async () => getEmployeePassport({ token: input.token }))),
    publish: publicProcedure
      .input(
        z.object({
          token: z.string().min(1),
          shareWageBands: z.boolean().optional(),
          shareEmployerNames: z.boolean().optional(),
        })
      )
      .mutation(({ input }) =>
        runDb(async () =>
          publishPassport({
            token: input.token,
            shareWageBands: input.shareWageBands,
            shareEmployerNames: input.shareEmployerNames,
          })
        )
      ),
    createShare: publicProcedure
      .input(
        z.object({
          token: z.string().min(1),
          recipientLabel: z.string().max(120).optional(),
          scope: z.enum(["summary", "full"]).optional(),
          ttlDays: z.number().int().min(1).max(365).optional(),
        })
      )
      .mutation(({ input }) =>
        runDb(async () =>
          createPassportShare({
            token: input.token,
            recipientLabel: input.recipientLabel,
            scope: input.scope,
            ttlDays: input.ttlDays,
          })
        )
      ),
    revokeShare: publicProcedure
      .input(z.object({ token: z.string().min(1), shareId: z.number().int().positive() }))
      .mutation(({ input }) =>
        runDb(async () => revokePassportShare({ token: input.token, shareId: input.shareId }))
      ),
    // Public verification surface: no login, the link (or the public id alone)
    // is the capability.
    view: publicProcedure
      .input(z.object({ publicId: z.string().min(1), shareToken: z.string().optional() }))
      .query(({ input }) =>
        runDb(async () =>
          getPublicPassport({ publicId: input.publicId, shareToken: input.shareToken ?? null })
        )
      ),
    verify: publicProcedure
      .input(z.object({ publicId: z.string().min(1) }))
      .query(({ input }) => runDb(async () => verifyPassportIntegrity({ publicId: input.publicId }))),
    // Staff kill-switch.
    revoke: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1), reason: z.string().min(3).max(200) }))
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await revokePassportForTrainee({
            traineeRef: input.traineeRef,
            reason: input.reason,
          });
          return { accepted: true, ...result };
        })
      ),
  }),
  exchange: router({
    employers: staffProcedure.query(() => runDb(async () => listEmployers())),
    postings: staffProcedure
      .input(z.object({ district: z.string().optional(), includeClosed: z.boolean().optional() }).optional())
      .query(({ input, ctx }) =>
        runDb(async () => {
          const scope = districtScope(ctx.user);
          return listPostings({
            district: scope ?? input?.district,
            includeClosed: input?.includeClosed,
          });
        })
      ),
    createPosting: staffProcedure
      .input(
        z.object({
          employerName: z.string().min(2).max(160),
          industry: z.string().max(120).optional(),
          district: z.string().min(2).max(96),
          title: z.string().min(2).max(160),
          roleCategory: z.string().min(2).max(120),
          wageBand: z.string().max(64).optional(),
          courseTags: z.array(z.string().max(120)).max(12).optional(),
          seats: z.number().int().min(1).max(500).optional(),
        })
      )
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await createPosting({
            employerName: input.employerName,
            industry: input.industry ?? null,
            district: input.district,
            title: input.title,
            roleCategory: input.roleCategory,
            wageBand: input.wageBand ?? null,
            courseTags: input.courseTags,
            seats: input.seats,
          });
          return { accepted: true, ...result };
        })
      ),
    board: staffProcedure
      .input(z.object({ district: z.string().optional() }).optional())
      .query(({ input, ctx }) =>
        runDb(async () => {
          const scope = districtScope(ctx.user);
          return getPlacementBoard({ district: scope ?? input?.district });
        })
      ),
    refer: staffProcedure
      .input(z.object({ traineeRef: z.string().min(1), postingId: z.number().int().positive() }))
      .mutation(({ input, ctx }) =>
        runDb(async () => {
          const result = await referToPosting({
            traineeRef: input.traineeRef,
            postingId: input.postingId,
            referredBy: ctx.user?.name ?? null,
          });
          return { accepted: true, ...result };
        })
      ),
    applications: staffProcedure
      .input(z.object({ district: z.string().optional() }).optional())
      .query(({ input, ctx }) =>
        runDb(async () => {
          const scope = districtScope(ctx.user);
          const rows = await listApplications({ district: scope ?? input?.district });
          return rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
          }));
        })
      ),
    confirmPlacement: staffProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive(),
          roleCategory: z.string().max(120).optional(),
          wageBand: z.string().max(64).optional(),
        })
      )
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await confirmPlacement({
            applicationId: input.applicationId,
            roleCategory: input.roleCategory ?? null,
            wageBand: input.wageBand ?? null,
          });
          return { accepted: true, ...result };
        })
      ),
    // Employee-facing (portal token): matched roles and one-tap apply.
    matches: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .query(({ input }) => runDb(async () => listEmployeeMatches({ token: input.token }))),
    // Named applyToPosting, not apply: tRPC reserves prototype method names.
    applyToPosting: publicProcedure
      .input(z.object({ token: z.string().min(1), postingId: z.number().int().positive() }))
      .mutation(({ input }) =>
        runDb(async () => {
          const result = await applyToPosting({ token: input.token, postingId: input.postingId });
          return { accepted: true, ...result };
        })
      ),
  }),
  scorecards: router({
    // Public accountability surface: provider performance, sample sizes under
    // ten suppressed.
    list: publicProcedure.query(() =>
      runDb(async () => (await listProviderScorecards()).map((row) => toProviderScorecard(row)))
    ),
    byProvider: publicProcedure
      .input(z.object({ slug: z.string().min(1) }))
      .query(({ input }) =>
        runDb(async () => {
          const rows = (await listProviderScorecards()).map((row) => toProviderScorecard(row));
          const found = rows.find((row) => row.slug === input.slug);
          if (!found) throw new NotFoundError("Provider scorecard", input.slug);
          return found;
        })
      ),
  }),
  benefits: router({
    // Employee portal (token-gated): view eligible schemes and apply.
    mine: rateLimited({ windowMs: 60_000, max: 30 })
      .input(z.object({ token: z.string().min(1) }))
      .query(({ input }) => runDb(async () => listEmployeeBenefits({ token: input.token }))),
    applyToScheme: rateLimited({ windowMs: 60_000, max: 20 })
      .input(z.object({ token: z.string().min(1), schemeId: z.number().int().positive() }))
      .mutation(({ input }) => runDb(async () => applyForBenefit(input))),
    // Staff: scheme catalogue and the claims register.
    schemes: staffProcedure
      .input(z.object({ activeOnly: z.boolean().optional() }).optional())
      .query(({ input }) => runDb(async () => listBenefitSchemes(input))),
    addScheme: staffProcedure
      .input(
        z.object({
          code: z.string().min(1).max(64),
          title: z.string().min(1).max(200),
          description: z.string().optional(),
          agency: z.string().min(1).max(160),
          district: z.string().optional(),
          eligibilityRules: z
            .object({
              outcomeTypes: z.array(z.string()).optional(),
              districts: z.array(z.string()).optional(),
              requiredCourses: z.array(z.string()).optional(),
              minWageMidpoint: z.number().optional(),
              minRetentionDays: z.number().optional(),
            })
            .optional(),
          active: z.boolean().optional(),
        })
      )
      .mutation(({ input }) => runDb(async () => createBenefitScheme(input))),
    claims: staffProcedure
      .input(z.object({ status: z.string().optional(), district: z.string().optional() }).optional())
      .query(({ input }) => runDb(async () => listBenefitClaims(input ?? {}))),
    setStatus: staffProcedure
      .input(
        z.object({
          benefitId: z.number().int().positive(),
          status: z.enum(["eligible", "applied", "approved", "received"]),
          notes: z.string().optional(),
        })
      )
      .mutation(({ input }) => runDb(async () => setBenefitStatus(input))),
  }),
  grievance: router({
    // Employee-portal (token-gated) support desk.
    open: rateLimited({ windowMs: 60_000, max: 10 })
      .input(
        z.object({
          token: z.string().min(1),
          kind: z.enum(["grievance", "wage_dispute", "harassment", "benefit", "other"]),
          subject: z.string().min(1).max(160),
          body: z.string().min(1),
        })
      )
      .mutation(({ input }) => runDb(async () => openGrievance(input))),
    myCase: rateLimited({ windowMs: 60_000, max: 30 })
      .input(z.object({ token: z.string().min(1), caseId: z.number().int().positive() }))
      .query(({ input }) => runDb(async () => getEmployeeCase(input))),
    reply: rateLimited({ windowMs: 60_000, max: 20 })
      .input(z.object({ token: z.string().min(1), caseId: z.number().int().positive(), body: z.string().min(1) }))
      .mutation(({ input }) => runDb(async () => postEmployeeReply(input))),
    mine: rateLimited({ windowMs: 60_000, max: 30 })
      .input(z.object({ token: z.string().min(1) }))
      .query(({ input }) => runDb(async () => listEmployeeCases(input))),
  }),
  cases: router({
    // Staff support-desk workbench (district-scoped).
    list: staffProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(({ input, ctx }) =>
        runDb(async () => listOpenCases({ district: districtScope(ctx.user), status: input?.status ?? null }))
      ),
    thread: staffProcedure
      .input(z.object({ caseId: z.number().int().positive() }))
      .query(({ input, ctx }) =>
        runDb(async () => getCaseThread({ caseId: input.caseId, district: districtScope(ctx.user) }))
      ),
    reply: staffProcedure
      .input(z.object({ caseId: z.number().int().positive(), body: z.string().min(1) }))
      .mutation(({ input, ctx }) =>
        runDb(async () =>
          postStaffReply({ caseId: input.caseId, district: districtScope(ctx.user), authorName: ctx.user?.name ?? null, body: input.body })
        )
      ),
    assign: staffProcedure
      .input(z.object({ caseId: z.number().int().positive(), assignedTo: z.string().min(1) }))
      .mutation(({ input, ctx }) =>
        runDb(async () => assignCase({ caseId: input.caseId, district: districtScope(ctx.user), assignedTo: input.assignedTo }))
      ),
    resolve: staffProcedure
      .input(z.object({ caseId: z.number().int().positive(), note: z.string().optional() }))
      .mutation(({ input, ctx }) =>
        runDb(async () => resolveCase({ caseId: input.caseId, district: districtScope(ctx.user), note: input.note ?? null }))
      ),
  }),
});

export type AppRouter = typeof appRouter;
