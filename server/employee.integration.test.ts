import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { appRouter } from "./routers";
import { makeContext } from "./testHelpers";
import { closeDb } from "./db";
import { runSeed } from "./seed";
import { purgeExpiredEmployeeDocuments } from "./scheduler";

/**
 * A1 — Employee profile & career record: portal links, the token-gated
 * employee payload, and auto-creation on verified employment.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const caller = appRouter.createCaller(makeContext());

describe.skipIf(!hasDb)("employee portal (live database)", () => {
  beforeAll(async () => {
    await runSeed();
  });

  afterAll(async () => {
    await runSeed();
    await closeDb();
  });

  it("issues a portal link for a verified placement and serves the career page", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    expect(link.accepted).toBe(true);
    expect(link.url).toContain("/me?token=");

    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;
    const portal = await caller.employee.me({ token });

    expect(portal.profile).toMatchObject({
      traineeRef: "SKL-7F4K2M",
      name: "Asha Patil",
      statusLabel: "Self-employed",
      industry: "Textiles",
      wageBand: "₹20k–₹29k",
    });
    // Skills come from completed training records.
    expect(portal.profile.skills).toContain("Advanced Tailoring & Boutique");

    // Wage history: the superseded ₹10k–₹19k pulse and the current ₹20k–₹29k band.
    expect(portal.wageHistory.map((point) => point.band)).toEqual(["₹10k–₹19k", "₹20k–₹29k"]);

    // The employee sees their own story (no internal casework).
    const titles = portal.timeline.map((event) => event.title);
    expect(titles).toContain("Course completed");
    expect(titles).toContain("Started self-employment");
    expect(titles).not.toContain("Recent job loss");
  });

  it("refuses portal links for trainees without a verified placement", async () => {
    // Imran is seeking work — no employee record exists.
    await expect(caller.employee.createLink({ traineeRef: "SKL-1D8Q9P" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects forged and anonymous portal tokens", async () => {
    await expect(caller.employee.me({ token: "forged-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates an employee record automatically on employer verification", { timeout: 30_000 }, async () => {
    // Ravi's evidence is pending in the fresh seed — no employee record yet.
    await expect(caller.employee.createLink({ traineeRef: "SKL-8N1T6C" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Employer verifies his employment through the one-time link flow...
    const verificationLink = await caller.verification.createLink({ traineeRef: "SKL-8N1T6C" });
    const verificationToken = new URLSearchParams(verificationLink.url.split("?")[1]).get("token")!;
    await caller.verification.submit({ token: verificationToken, stillEmployed: true, roleCategory: "Electrician" });

    // ...which opens the portal: a link can now be issued and used.
    const link = await caller.employee.createLink({ traineeRef: "SKL-8N1T6C" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;
    const portal = await caller.employee.me({ token });
    expect(portal.profile).toMatchObject({
      traineeRef: "SKL-8N1T6C",
      statusLabel: "Employed",
      roleCategory: "Electrician",
    });
  });

  it("document vault: consent capture, upload, signed url, and delete", { timeout: 60_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;

    // Upload lands in the private bucket and captures document-storage consent.
    const uploaded = await caller.employee.documents.upload({
      token,
      kind: "certificate",
      title: "Tailoring certificate scan",
      fileName: "certificate.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 test certificate").toString("base64"),
    });
    expect(uploaded).toMatchObject({ kind: "certificate", title: "Tailoring certificate scan" });

    const list = await caller.employee.documents.list({ token });
    expect(list).toHaveLength(1);
    // Certificates have no expiry — they stay until the employee deletes them.
    expect(list[0].retentionUntil).toBeNull();

    const consent = await caller.consent.status({ traineeId: "asha-patil" });
    expect(consent.purposes.some((p) => p.purposeCode === "document_storage" && p.status === "granted")).toBe(true);

    const { url } = await caller.employee.documents.url({ token, documentId: uploaded.id });
    expect(url).toContain("supabase");

    const deleted = await caller.employee.documents.delete({ token, documentId: uploaded.id });
    expect(deleted.deleted).toBe(true);
    await expect(caller.employee.documents.url({ token, documentId: uploaded.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("document vault rejects disallowed file types and oversized uploads", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-4M2V8A" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;

    await expect(
      caller.employee.documents.upload({
        token,
        kind: "other",
        title: "Nope",
        fileName: "script.exe",
        mimeType: "application/x-msdownload",
        dataBase64: Buffer.from("MZ").toString("base64"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      caller.employee.documents.upload({
        token,
        kind: "other",
        title: "Too big",
        fileName: "big.pdf",
        mimeType: "application/pdf",
        dataBase64: Buffer.alloc(6 * 1024 * 1024).toString("base64"),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("shareable certificates expose only training information", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;
    const portal = await caller.employee.me({ token });
    const record = portal.certificates[0];

    const share = await caller.employee.certificates.createShareLink({ token, trainingRecordId: record.id });
    expect(share.url).toContain("/certificates?token=");

    const shareToken = new URLSearchParams(share.url.split("?")[1]).get("token")!;
    const view = await caller.employee.certificates.view({ token: shareToken });
    expect(view).toMatchObject({
      name: "Asha Patil",
      course: "Advanced Tailoring & Boutique",
      verified: true,
    });
    // The public view never carries contact details.
    expect(JSON.stringify(view)).not.toContain("contactPhone");

    await expect(
      caller.employee.certificates.view({ token: "forged" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retention worker purges expired documents", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;
    const uploaded = await caller.employee.documents.upload({
      token,
      kind: "payslip",
      title: "Old payslip",
      fileName: "payslip.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 old payslip").toString("base64"),
    });
    expect(uploaded.retentionUntil).not.toBeNull();

    // Force the retention window into the past and run the worker.
    const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
    await sql`update "employeeDocuments" set "retentionUntil" = '2026-01-01' where id = ${uploaded.id}`;
    await sql.end();

    const result = await purgeExpiredEmployeeDocuments(new Date("2026-09-12"));
    expect(result.purged).toBeGreaterThanOrEqual(1);
    await expect(
      caller.employee.documents.url({ token, documentId: uploaded.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
