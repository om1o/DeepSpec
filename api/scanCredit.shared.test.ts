import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReservedScanCredit, reserveScanCredit } from "./billing.shared";

const supabaseMock = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => supabaseMock);

const ENV = {
  DEEPSPEC_ENFORCE_SCAN_CREDITS: "true",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  SUPABASE_URL: "https://example.supabase.co",
};
const HEADERS = { authorization: "Bearer token-1" };

type EntitlementRow = { user_id: string; status: string; scan_allowance: number; scans_used: number } & Record<string, unknown>;

/**
 * An in-memory billing_entitlements table. update() applies whatever filters were chained on when
 * it is awaited (or .select()ed), the way PostgREST does, so a compare-and-set on scans_used only
 * lands when the stored value still matches.
 */
function createEntitlementStore(initial: Partial<EntitlementRow> = {}) {
  const row: EntitlementRow = {
    user_id: "user-1",
    status: "active",
    scan_allowance: 5,
    scans_used: 0,
    ...initial,
  };

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => ({ data: userId === row.user_id ? { ...row } : null, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const apply = () => {
          const matches = filters.every(([column, value]) => row[column] === value);
          if (matches) {
            Object.assign(row, values);
          }
          return matches ? [{ ...row }] : [];
        };
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          select: async () => ({ data: apply(), error: null }),
          then: (resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) => {
            apply();
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    })),
  };

  supabaseMock.createClient.mockReturnValue(client);
  return row;
}

describe("scan credit accounting", () => {
  afterEach(() => {
    supabaseMock.createClient.mockReset();
  });

  it("counts every scan when two finish at the same time", async () => {
    const row = createEntitlementStore({ scans_used: 0 });

    // Both scans were reserved while the counter read 0 — each then spends 25-45s in the AI call.
    const first = await reserveScanCredit(HEADERS, ENV);
    const second = await reserveScanCredit(HEADERS, ENV);
    await Promise.all([consumeReservedScanCredit(first, ENV), consumeReservedScanCredit(second, ENV)]);

    expect(row.scans_used).toBe(2);
  });

  it("counts a scan that finishes after another device already used a credit", async () => {
    const row = createEntitlementStore({ scans_used: 3 });

    const reservation = await reserveScanCredit(HEADERS, ENV);
    row.scans_used = 4; // another device's scan completed while this one was in flight
    await consumeReservedScanCredit(reservation, ENV);

    expect(row.scans_used).toBe(5);
  });

  it("still counts a single uncontended scan once", async () => {
    const row = createEntitlementStore({ scans_used: 1 });

    const reservation = await reserveScanCredit(HEADERS, ENV);
    await consumeReservedScanCredit(reservation, ENV);

    expect(row.scans_used).toBe(2);
  });

  it("does nothing when credit enforcement is off", async () => {
    const row = createEntitlementStore({ scans_used: 1 });

    const reservation = await reserveScanCredit(HEADERS, {});
    await consumeReservedScanCredit(reservation, {});

    expect(reservation).toEqual({ enforced: false, ok: true });
    expect(row.scans_used).toBe(1);
  });

  it("refuses a scan once the allowance is used up", async () => {
    createEntitlementStore({ scan_allowance: 5, scans_used: 5 });

    await expect(reserveScanCredit(HEADERS, ENV)).resolves.toMatchObject({
      ok: false,
      error: { status: 402, body: { error: { code: "scan_limit_reached" } } },
    });
  });
});
