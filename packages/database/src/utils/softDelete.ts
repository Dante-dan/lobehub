import { eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Predicate every ownership-scoped read of a recycle-bin-aware table must
 * carry: `is_deleted IS NULL OR is_deleted = FALSE`.
 *
 * A live row leaves `is_deleted`
 * NULL — only a trashed row is stamped (see `softDeleteColumns()` in
 * `schemas/_helpers.ts`). `is_deleted = false` evaluates to NULL for those
 * rows, which is not true, so an equality filter would hide the entire table
 * instead of just its trashed rows. The explicit NULL/false branches are
 * equivalent to `IS NOT TRUE`, including rows explicitly stamped `false`.
 * Keep the expanded form: a non-indexed `IS NOT TRUE` qualifier prevents
 * pg_search 0.21.4's scored custom scan, so projecting paradedb.score() fails.
 *
 * Kept as a named helper (rather than an inline predicate) so the call sites
 * are greppable when auditing which reads still see trashed rows.
 * `buildWorkspaceWhere` applies it automatically for tables in
 * `TRASH_AWARE_TABLES`; use this only where that funnel is bypassed.
 */
export const notTrashed = (isDeleted: AnyPgColumn): SQL =>
  sql`(${isDeleted} IS NULL OR ${isDeleted} = FALSE)`;

/** Inverse of {@link notTrashed}: rows sitting in the recycle bin. */
export const isTrashed = (isDeleted: AnyPgColumn): SQL => eq(isDeleted, true);

/**
 * The write half of the `is_deleted IS TRUE ⟺ deleted_at IS NOT NULL`
 * invariant. Every soft delete sets both columns from one stamp …
 */
export const trashStamp = (deletedAt: Date) => ({ deletedAt, isDeleted: true }) as const;

/**
 * … and every restore clears both back to NULL — the live state — so a
 * restored row is indistinguishable from one that was never trashed.
 */
export const restoreStamp = () => ({ deletedAt: null, isDeleted: null }) as const;

/** Options shared by every model-level `softDelete*` primitive. */
export interface SoftDeleteOptions {
  /** Trash-time instant shared across a cascade so children carry the root's stamp. */
  deletedAt: Date;
  /**
   * Workspace non-owner members may only sweep their own rows (mirrors the
   * `restrictToCreator` convention of the hard-delete paths).
   */
  restrictToCreator?: boolean;
}
