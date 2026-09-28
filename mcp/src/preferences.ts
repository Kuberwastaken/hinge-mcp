import { z } from "zod";
const values = z.array(z.string().max(100)).max(100);
const range = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
    "min must not exceed max",
  );
export const preferencesSchema = z
  .object({
    genderedAgeRanges: z.record(z.string(), range).optional(),
    genderedHeightRanges: z.record(z.string(), range).optional(),
    maxDistance: z.number().nonnegative().optional(),
    dealbreakers: z.record(z.string(), z.unknown()).optional(),
    religions: values.optional(),
    drinking: values.optional(),
    marijuana: values.optional(),
    relationshipTypes: values.optional(),
    drugs: values.optional(),
    children: values.optional(),
    ethnicities: values.optional(),
    smoking: values.optional(),
    educationAttained: values.optional(),
    familyPlans: z.unknown().optional(),
    datingIntentions: values.optional(),
    politics: values.optional(),
    genderPreferences: values.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one preference");
