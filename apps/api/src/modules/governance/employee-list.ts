import { z } from "zod";

/**
 * HCIS ORG-014 as the Portal Organ Yayasan reads it (ORGAN-IMPL-001 §3.1). Strict on purpose:
 * an item carrying any field beyond the six agreed ones fails the whole page rather than passing
 * more personal data through to the browser.
 */
const text = z.string().max(300);
const nullableText = text.nullable();

export const employeeListSchema = z.object({
  items: z.array(z.object({
    fullName: text,
    employeeNumber: text,
    unitName: nullableText,
    position: nullableText,
    employmentStatus: nullableText,
    startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }).strict()).max(100),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    pageCount: z.number().int().min(0),
  }),
  units: z.array(z.object({ id: z.string().uuid(), name: text })).max(500),
});

export type EmployeeList = z.infer<typeof employeeListSchema>;

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(2).max(80).optional(),
  unitId: z.string().uuid().optional(),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
