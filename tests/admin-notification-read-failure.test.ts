import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPlatformProxy } from "wrangler";
import { KVNamespace } from "@miniflare/kv";
import { MemoryStorage } from "@miniflare/storage-memory";
import worker from "../src/index";
import { createTelegramSessionCookie } from "../src/api/admin-auth";
import { disableConsoleLogging } from "./test-utils";

vi.mock("wrangler", () => ({
  getPlatformProxy: async () => ({
    env: {
      HISTORY: new KVNamespace(new MemoryStorage()),
      COUNTERS: new KVNamespace(new MemoryStorage()),
    },
  }),
}));

const SETTINGS_KEY = "notification_settings:1";

const { env } = await getPlatformProxy<any>();
env.TOKEN = "t";
env.SECRET = "s";
env.TELEGRAM_BOT_USERNAME = "test_bot";
env.SUMMARY_PROVIDER = "cloudflare";
env.SUMMARY_MODEL = "test-model";
env.DEBUG_LOGS = "false";
env.AI = { run: vi.fn().mockResolvedValue({ response: "x" }) };

let tasks: Promise<any>[] = [];
let ctx: any;
beforeEach(() => {
  disableConsoleLogging();
  tasks = [];
  ctx = { waitUntil: (p: Promise<any>) => tasks.push(p) };
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // KVNamespace stores data in a private #storage field, so reassigning the
  // public `.storage` property (the pattern used elsewhere) does NOT clear it.
  // Use a brand-new namespace per test for real isolation.
  env.HISTORY = new KVNamespace(new MemoryStorage());
  env.COUNTERS = new KVNamespace(new MemoryStorage());
});

const telegramUserId = 42;
async function adminSessionHeaders() {
  const cookie = await createTelegramSessionCookie(env, {
    id: telegramUserId,
    first_name: "Admin",
    username: "admin_user",
    auth_date: Math.floor(Date.now() / 1000),
  });
  return { Cookie: cookie };
}

function mockTelegramMembership(status = "administrator") {
  return vi.spyOn(global, "fetch").mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.includes("/getChatMember")) {
      return Response.json({ ok: true, result: { status } });
    }
    return new Response(null, { status: 200 });
  });
}

const seeded = {
  chatId: "1",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "admin-telegram:42",
  adminOnly: true,
  quietHours: { enabled: true, startTime: { hour: 0, minute: 0 }, endTime: { hour: 6, minute: 0 } },
  allowedUsers: ["42"],
  notifications: {
    criminal_reports: { enabled: false, frequency: "instant", includeDetails: true, maxItemsInReport: 10, threshold: 1 },
    profanity_reports: { enabled: true, frequency: "daily", time: { hour: 9, minute: 0 }, includeDetails: false, maxItemsInReport: 5, threshold: 5 },
    activity_summary: { enabled: false, frequency: "daily", time: { hour: 18, minute: 0 }, includeDetails: true, maxItemsInReport: 10 },
    daily_summary: { enabled: false, frequency: "daily", time: { hour: 20, minute: 0 }, includeDetails: true, maxItemsInReport: 15 },
    weekly_summary: { enabled: true, frequency: "weekly", time: { hour: 10, minute: 0 }, includeDetails: true, maxItemsInReport: 20 },
    monthly_summary: { enabled: false, frequency: "monthly", time: { hour: 10, minute: 0 }, includeDetails: true, maxItemsInReport: 25 },
  },
};

const postEdit = async () =>
  worker.fetch(
    new Request("http://localhost/admin/api/notifications?chatId=1", {
      method: "POST",
      headers: { ...(await adminSessionHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        notifications: { daily_summary: { enabled: true } },
      }),
    }),
    env,
    ctx,
  );

// Replaces env.HISTORY with a Proxy over the fresh per-test KV that:
//  - throws a transient read error on the settings key when failReadOn(callIndex) is true
//  - counts puts against the settings key
// All other KV operations pass through to the real backing store. Returns the
// underlying KV (for direct assertions) and the put counter.
function instrumentHistory(failReadOn?: (callIndex: number) => boolean) {
  const realKV = env.HISTORY;
  const settingsPutCount = { value: 0 };
  let settingsReadCount = 0;
  const wrapped = new Proxy(realKV as any, {
    get(target: any, prop: string | symbol) {
      if (prop === "get") {
        return async (key: string, options?: any) => {
          if (key === SETTINGS_KEY) {
            const callIndex = settingsReadCount++;
            if (failReadOn && failReadOn(callIndex)) {
              throw new Error("transient KV read failure");
            }
          }
          return target.get(key, options);
        };
      }
      if (prop === "put") {
        return async (key: string, value: any, options?: any) => {
          if (key === SETTINGS_KEY) {
            settingsPutCount.value += 1;
          }
          return target.put(key, value, options);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  env.HISTORY = wrapped as any;
  return { realKV, settingsPutCount };
}

async function storedSettings(realKV: any): Promise<any> {
  const stored = await realKV.get(SETTINGS_KEY);
  return stored ? JSON.parse(stored as string) : null;
}

describe("admin notification POST: transient KV read failure must not clobber settings", () => {
  it("returns 503 ADMIN_UNAVAILABLE and writes nothing when the first read throws", async () => {
    mockTelegramMembership("administrator");
    await env.HISTORY.put(SETTINGS_KEY, JSON.stringify(seeded));

    const { realKV, settingsPutCount } = instrumentHistory((callIndex) => callIndex === 0);

    const res = await postEdit();

    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ADMIN_UNAVAILABLE");
    expect(body.error.requestId).toEqual(expect.any(String));

    expect(settingsPutCount.value).toBe(0);

    const stored = await storedSettings(realKV);
    expect(stored).not.toBeNull();
    expect(stored.notifications.profanity_reports.enabled).toBe(true);
    expect(stored.notifications.weekly_summary.enabled).toBe(true);
    expect(stored.adminOnly).toBe(true);
    expect(stored.quietHours).toBeDefined();
    expect(stored.allowedUsers).toEqual(["42"]);
  });

  it("returns 503 and writes nothing when the second read (inside updateChatSettings) throws", async () => {
    mockTelegramMembership("administrator");
    await env.HISTORY.put(SETTINGS_KEY, JSON.stringify(seeded));

    const { realKV, settingsPutCount } = instrumentHistory((callIndex) => callIndex === 1);

    const res = await postEdit();

    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("ADMIN_UNAVAILABLE");

    expect(settingsPutCount.value).toBe(0);

    const stored = await storedSettings(realKV);
    expect(stored).not.toBeNull();
    expect(stored.notifications.daily_summary.enabled).toBe(false);
    expect(stored.notifications.profanity_reports.enabled).toBe(true);
    expect(stored.notifications.weekly_summary.enabled).toBe(true);
    expect(stored.adminOnly).toBe(true);
    expect(stored.quietHours).toBeDefined();
    expect(stored.allowedUsers).toEqual(["42"]);
  });

  it("returns 503 and preserves the unparseable stored blob when JSON.parse throws", async () => {
    mockTelegramMembership("administrator");
    await env.HISTORY.put(SETTINGS_KEY, "{not valid json");

    const { realKV, settingsPutCount } = instrumentHistory();

    const res = await postEdit();

    expect(res.status).toBe(503);
    expect(settingsPutCount.value).toBe(0);
    expect(await realKV.get(SETTINGS_KEY)).toBe("{not valid json");
  });

  it("preserves untouched settings and applies only the requested edit on the happy path", async () => {
    mockTelegramMembership("administrator");
    await env.HISTORY.put(SETTINGS_KEY, JSON.stringify(seeded));

    const { realKV, settingsPutCount } = instrumentHistory();

    const res = await postEdit();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.ok).toBe(true);
    expect(body.settings.notifications.daily_summary.enabled).toBe(true);
    expect(body.settings.notifications.profanity_reports.enabled).toBe(true);
    expect(body.settings.notifications.weekly_summary.enabled).toBe(true);
    expect(body.settings.adminOnly).toBe(true);
    expect(body.settings.quietHours).toBeDefined();
    expect(body.settings.allowedUsers).toEqual(["42"]);
    expect(body.settings.updatedBy).toBe("admin-telegram:42");
    expect(body.settings.updatedByName).toBe("Admin");

    expect(settingsPutCount.value).toBe(1);

    const stored = await storedSettings(realKV);
    expect(stored.notifications.daily_summary.enabled).toBe(true);
    expect(stored.notifications.profanity_reports.enabled).toBe(true);
  });

  it("creates settings from in-memory defaults with a single write on a first edit when settings are absent", async () => {
    mockTelegramMembership("administrator");

    const { realKV, settingsPutCount } = instrumentHistory();

    const res = await postEdit();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.ok).toBe(true);
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.notifications.daily_summary.enabled).toBe(true);
    expect(body.settings.adminOnly).toBe(false);
    expect(body.settings.quietHours).toBeUndefined();
    expect(body.settings.allowedUsers).toBeUndefined();
    expect(body.settings.updatedBy).toBe("admin-telegram:42");
    expect(body.settings.updatedByName).toBe("Admin");

    expect(settingsPutCount.value).toBe(1);

    const stored = await storedSettings(realKV);
    expect(stored).not.toBeNull();
    expect(stored.notifications.daily_summary.enabled).toBe(true);
    expect(stored.adminOnly).toBe(false);
    expect(stored.updatedBy).toBe("admin-telegram:42");
  });

  it("rejects edits from non-admin chat members without writing settings", async () => {
    mockTelegramMembership("member");
    await env.HISTORY.put(SETTINGS_KEY, JSON.stringify(seeded));

    const { realKV, settingsPutCount } = instrumentHistory();

    const res = await postEdit();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "only chat administrators can edit notification settings",
    });

    expect(settingsPutCount.value).toBe(0);

    const stored = await storedSettings(realKV);
    expect(stored).not.toBeNull();
    expect(stored.notifications.profanity_reports.enabled).toBe(true);
    expect(stored.notifications.weekly_summary.enabled).toBe(true);
  });
});
