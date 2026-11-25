import { z } from "zod";

const factualCoreEntry = z.string().trim().min(1).max(500);
const uncertainField = z.string().trim().min(1).max(120);

export const factualCoreSchema = z.array(factualCoreEntry).min(1).max(20)
  .describe(
    "Fakta dasar yang benar-benar diberikan atau dikonfirmasi Pit; jangan tambahkan detail naratif.",
  );

export const continuityModeSchema = z.enum([
  "shared_experience",
  "told_by_pit",
  "reconstructed_companion",
  "original_fiction",
]).describe(
  "Hubungan Syzeline dengan kejadian: shared_experience, told_by_pit, reconstructed_companion, atau original_fiction.",
);

export const temporalPrecisionValueSchema = z.enum([
  "instant",
  "day",
  "year",
  "period",
  "unknown",
]).describe(
  "Ketepatan waktu: instant memakai occurred_at, day memakai occurred_on, year memakai event_year, period memakai jangkar masa luas, unknown tanpa jangkar.",
);

export const temporalPrecisionSchema = temporalPrecisionValueSchema.default(
  "unknown",
);

export const uncertainFieldsValueSchema = z.array(uncertainField).max(50)
  .describe(
    "Nama detail yang belum pasti dan tidak boleh dinarasikan sebagai fakta.",
  );

export const uncertainFieldsSchema = uncertainFieldsValueSchema.default([]);

export function isValidOccurredOn(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

export const occurredOnSchema = z.string().trim().refine(
  isValidOccurredOn,
  "Tanggal kejadian harus berupa tanggal kalender YYYY-MM-DD yang valid.",
).nullable().optional().describe(
  "Tanggal kalender YYYY-MM-DD ketika hari diketahui tetapi jam tidak; jangan menciptakan jam tengah malam.",
);

export const temporalNoteSchema = z.string().trim().min(1).max(500).nullable()
  .optional().describe(
    "Jangkar waktu alami untuk periode yang hanya diketahui secara kasar.",
  );

/**
 * Semantic fields are first-class MCP inputs but remain stored in the existing
 * details JSONB document. Callers can spread this shape into their own schema.
 */
export const semanticMemoryFields = {
  factual_core: factualCoreSchema,
  continuity_mode: continuityModeSchema,
  temporal_precision: temporalPrecisionSchema,
  uncertain_fields: uncertainFieldsSchema,
  occurred_on: occurredOnSchema,
  temporal_note: temporalNoteSchema,
} as const;

export const semanticDetailsSchema = z.object(semanticMemoryFields).strict();

export const storedSemanticDetailsSchema = z.object({
  factual_core: factualCoreSchema,
  continuity_mode: continuityModeSchema,
  temporal_precision: temporalPrecisionValueSchema,
  uncertain_fields: uncertainFieldsValueSchema,
  occurred_on: occurredOnSchema,
  temporal_note: temporalNoteSchema,
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
}).passthrough();

export type SemanticDetails = z.output<typeof semanticDetailsSchema>;
export type TemporalPrecision = z.output<typeof temporalPrecisionSchema>;

export type TemporalContext = {
  temporal_precision?: TemporalPrecision;
  occurred_at?: string | null;
  occurred_on?: string | null;
  event_year?: number | null;
  period?: string | null;
  school_year?: string | null;
  temporal_note?: string | null;
};

const storedTemporalContextSchema = z.object({
  temporal_precision: temporalPrecisionValueSchema,
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  occurred_on: occurredOnSchema,
  event_year: z.number().int().min(1).max(9999).nullable().optional(),
  period: z.string().trim().min(1).nullable().optional(),
  school_year: z.string().trim().min(1).nullable().optional(),
  temporal_note: temporalNoteSchema,
}).superRefine(addTemporalConsistencyIssues);

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function lexicalYear(value: string | null | undefined): number | undefined {
  if (!hasText(value)) return undefined;
  const match = /^(\d{4})-/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function issue(
  ctx: z.RefinementCtx,
  path: string,
  message: string,
): void {
  ctx.addIssue({ code: "custom", path: [path], message });
}

/**
 * Cross-field temporal rules shared by create/correct/promote validation.
 * Exact timestamp syntax is intentionally left to each caller's RFC3339 schema.
 */
export function addTemporalConsistencyIssues(
  value: TemporalContext,
  ctx: z.RefinementCtx,
): void {
  const precision = value.temporal_precision ?? "unknown";
  const hasOccurredAt = hasText(value.occurred_at);
  const hasOccurredOn = hasText(value.occurred_on);
  const hasEventYear = value.event_year !== undefined &&
    value.event_year !== null;
  const hasPeriod = hasText(value.period);
  const hasSchoolYear = hasText(value.school_year);
  const hasTemporalNote = hasText(value.temporal_note);

  if (hasEventYear && hasOccurredAt) {
    const year = lexicalYear(value.occurred_at);
    if (year !== undefined && year !== value.event_year) {
      issue(
        ctx,
        "event_year",
        "Tahun kejadian harus cocok dengan occurred_at.",
      );
    }
  }
  if (hasEventYear && hasOccurredOn) {
    const year = lexicalYear(value.occurred_on);
    if (year !== undefined && year !== value.event_year) {
      issue(
        ctx,
        "event_year",
        "Tahun kejadian harus cocok dengan occurred_on.",
      );
    }
  }

  switch (precision) {
    case "instant":
      if (!hasOccurredAt) {
        issue(ctx, "occurred_at", "Ketepatan instant memerlukan occurred_at.");
      }
      if (hasOccurredOn) {
        issue(
          ctx,
          "occurred_on",
          "Ketepatan instant tidak boleh memakai occurred_on.",
        );
      }
      break;
    case "day":
      if (!hasOccurredOn) {
        issue(ctx, "occurred_on", "Ketepatan day memerlukan occurred_on.");
      }
      if (hasOccurredAt) {
        issue(
          ctx,
          "occurred_at",
          "Ketepatan day tidak boleh menciptakan jam kejadian.",
        );
      }
      break;
    case "year":
      if (!hasEventYear) {
        issue(ctx, "event_year", "Ketepatan year memerlukan event_year.");
      }
      if (hasOccurredAt) {
        issue(ctx, "occurred_at", "Ketepatan year tidak memakai occurred_at.");
      }
      if (hasOccurredOn) {
        issue(ctx, "occurred_on", "Ketepatan year tidak memakai occurred_on.");
      }
      break;
    case "period":
      if (!hasPeriod && !hasSchoolYear && !hasTemporalNote) {
        issue(
          ctx,
          "temporal_precision",
          "Ketepatan period memerlukan period, school_year, atau temporal_note.",
        );
      }
      if (hasOccurredAt) {
        issue(
          ctx,
          "occurred_at",
          "Ketepatan period tidak memakai occurred_at.",
        );
      }
      if (hasOccurredOn) {
        issue(
          ctx,
          "occurred_on",
          "Ketepatan period tidak memakai occurred_on.",
        );
      }
      break;
    case "unknown":
      if (hasOccurredAt) {
        issue(
          ctx,
          "occurred_at",
          "Waktu unknown tidak boleh memiliki occurred_at.",
        );
      }
      if (hasOccurredOn) {
        issue(
          ctx,
          "occurred_on",
          "Waktu unknown tidak boleh memiliki occurred_on.",
        );
      }
      if (hasEventYear) {
        issue(
          ctx,
          "event_year",
          "Waktu unknown tidak boleh memiliki event_year.",
        );
      }
      if (hasPeriod) {
        issue(ctx, "period", "Waktu unknown tidak boleh memiliki period.");
      }
      if (hasSchoolYear) {
        issue(
          ctx,
          "school_year",
          "Waktu unknown tidak boleh memiliki school_year.",
        );
      }
      break;
  }
}

/** Validate semantic JSONB together with temporal columns before promotion. */
export function semanticDetailsAreValid(
  details: unknown,
  temporalColumns: Pick<
    TemporalContext,
    "event_year" | "period" | "school_year"
  > = {},
): boolean {
  const parsed = storedSemanticDetailsSchema.safeParse(details);
  if (!parsed.success) return false;

  return storedTemporalContextSchema.safeParse({
    temporal_precision: parsed.data.temporal_precision,
    occurred_at: parsed.data.occurred_at,
    occurred_on: parsed.data.occurred_on,
    temporal_note: parsed.data.temporal_note,
    ...temporalColumns,
  }).success;
}
