import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_COOKIE,
  buildApp,
  createSignedSessionToken,
  fetchWorker,
  hashPassword,
  isValidSignedSessionToken,
  verifyPassword,
} from "../src/app.js";

const SESSION_SECRET = "test-session-secret-that-is-more-than-thirty-two-characters";

class MemoryStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  first() {
    return this.database.execute(this.sql, this.args, "first");
  }

  run() {
    return this.database.execute(this.sql, this.args, "run");
  }

  all() {
    return this.database.execute(this.sql, this.args, "all");
  }
}

class MemoryD1 {
  constructor() {
    this.usersById = new Map();
    this.userIdsByEmail = new Map();
    this.sessions = new Map();
    this.rateLimits = new Map();
    this.queries = [];
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async execute(sql, args, mode) {
    this.queries.push({ sql, args, mode });

    if (sql === "SELECT 1 AS ok") return { ok: 1 };

    if (sql.startsWith("INSERT INTO rate_limits") && sql.includes("RETURNING count")) {
      const [key, bucket] = args;
      const storageKey = `${key}:${bucket}`;
      const count = (this.rateLimits.get(storageKey) || 0) + 1;
      this.rateLimits.set(storageKey, count);
      return { count };
    }

    if (sql.startsWith("SELECT id FROM users WHERE email")) {
      const id = this.userIdsByEmail.get(String(args[0]).toLowerCase());
      return id ? { id } : null;
    }

    if (sql.startsWith("INSERT INTO users")) {
      const [id, name, email, passwordHash, passwordSalt, passwordIterations, passwordScheme] = args;
      const now = new Date().toISOString();
      const user = {
        id,
        name,
        email,
        password_hash: passwordHash,
        password_salt: passwordSalt,
        password_iterations: passwordIterations,
        password_scheme: passwordScheme,
        role: "couple",
        status: "active",
        created_at: now,
      };
      this.usersById.set(id, user);
      this.userIdsByEmail.set(email.toLowerCase(), id);
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.startsWith("INSERT INTO sessions")) {
      const [tokenHash, userId, expiresAt, userAgentHash] = args;
      this.sessions.set(tokenHash, { tokenHash, userId, expiresAt, userAgentHash });
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.startsWith("SELECT id, name, email, role, status, created_at FROM users WHERE id")) {
      return this.usersById.get(args[0]) || null;
    }

    if (sql.startsWith("SELECT id, name, email, role, status, created_at, password_hash")) {
      const id = this.userIdsByEmail.get(String(args[0]).toLowerCase());
      return id ? this.usersById.get(id) : null;
    }

    if (sql.startsWith("SELECT u.id, u.name, u.email")) {
      const [tokenHash, now] = args;
      const session = this.sessions.get(tokenHash);
      if (!session || session.expiresAt <= now) return null;
      const user = this.usersById.get(session.userId);
      return user?.status === "active" ? user : null;
    }

    if (sql.startsWith("SELECT id, slug, business_name, status FROM vendors")) return null;

    if (sql.startsWith("DELETE FROM sessions WHERE token_hash")) {
      this.sessions.delete(args[0]);
      return { success: true, meta: { changes: 1 } };
    }

    if (sql.startsWith("UPDATE users SET last_login_at")) return { success: true, meta: { changes: 1 } };

    if (mode === "all") return { results: [] };
    throw new Error(`MemoryD1 received an unsupported query: ${sql}`);
  }
}

function environment(database = new MemoryD1()) {
  return {
    DB: database,
    SESSION_SECRET,
    COOKIE_SECURE: "true",
    APP_VERSION: "test",
    ENVIRONMENT: "test",
    ALLOW_SERVER_PASSWORD_HASHING: "true",
  };
}

function jsonRequest(body, extra = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(extra.headers || {}) },
    body: JSON.stringify(body),
    ...extra,
  };
}

test("production health fails closed when required authentication secrets are missing", async () => {
  const app = buildApp();
  const missing = await app.request("https://api.example.test/health", {}, { DB: new MemoryD1(), ENVIRONMENT: "production" });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).data.authentication, "unavailable");

  const ready = await app.request(
    "https://api.example.test/health",
    {},
    {
      DB: new MemoryD1(),
      ENVIRONMENT: "production",
      SESSION_SECRET,
      PASSWORD_PEPPER: "health-password-pepper-that-is-more-than-thirty-two-characters",
    },
  );
  assert.equal(ready.status, 200, await ready.clone().text());
  assert.equal((await ready.json()).data.authentication, "ok");
});

test("PBKDF2 password hashes use a random salt and reject a wrong password", async () => {
  const first = await hashPassword("VerySecure123");
  const second = await hashPassword("VerySecure123");

  assert.notEqual(first.passwordSalt, second.passwordSalt);
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(await verifyPassword("VerySecure123", first.passwordHash, first.passwordSalt, first.passwordIterations), true);
  assert.equal(await verifyPassword("NotThePassword123", first.passwordHash, first.passwordSalt, first.passwordIterations), false);
});

test("signed session tokens fail verification after tampering", async () => {
  const env = { SESSION_SECRET };
  const token = await createSignedSessionToken(env);

  assert.equal(await isValidSignedSessionToken(token, env), true);
  assert.equal(await isValidSignedSessionToken(`${token.slice(0, -1)}x`, env), false);
  assert.equal(await isValidSignedSessionToken("unsigned", env), false);
});

test("registration stores no plaintext password and issues a hardened session cookie", async () => {
  const app = buildApp();
  const db = new MemoryD1();
  const env = environment(db);
  const response = await app.request(
    "https://api.example.test/api/v1/auth/register",
    jsonRequest({ name: "Aarav Mehta", email: "AARAV@example.com", password: "VerySecure123" }),
    env,
  );

  assert.equal(response.status, 201, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.data.user.email, "aarav@example.com");
  assert.equal(payload.data.user.role, "couple");
  const stored = [...db.usersById.values()][0];
  assert.notEqual(stored.password_hash, "VerySecure123");
  assert.equal("password" in stored, false);

  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const cookie = setCookie.split(";", 1)[0];
  const me = await app.request(
    "https://api.example.test/api/v1/auth/me",
    { headers: { cookie } },
    env,
  );
  assert.equal(me.status, 200, await me.clone().text());
  assert.equal((await me.json()).data.user.id, stored.id);
});

test("production auth stores a server-peppered client verifier and never runs server PBKDF2", async () => {
  const app = buildApp();
  const db = new MemoryD1();
  const env = {
    DB: db,
    SESSION_SECRET,
    PASSWORD_PEPPER: "test-password-pepper-that-is-more-than-thirty-two-characters",
    COOKIE_SECURE: "true",
    ENVIRONMENT: "production",
  };
  const passwordVerifier = "2ElopB-2WRviXwYatnXCSMKokkqCZG-Ra8ARF5H7m4I";
  const registration = await app.request(
    "https://api.example.test/api/v1/auth/register",
    jsonRequest({
      name: "Mira Shah",
      email: "MIRA@example.com",
      passwordVerifier,
      passwordKdf: "pbkdf2-sha256-v1",
    }),
    env,
  );

  assert.equal(registration.status, 201, await registration.clone().text());
  const stored = [...db.usersById.values()][0];
  assert.equal(stored.password_scheme, "client-verifier-v1");
  assert.equal(stored.password_iterations, 310000);
  assert.notEqual(stored.password_hash, passwordVerifier);

  const login = await app.request(
    "https://api.example.test/api/v1/auth/login",
    jsonRequest({ email: "mira@example.com", passwordVerifier, passwordKdf: "pbkdf2-sha256-v1" }),
    env,
  );
  assert.equal(login.status, 200, await login.clone().text());
  assert.match(login.headers.get("set-cookie"), /melaiva_session=/);

  const plaintext = await app.request(
    "https://api.example.test/api/v1/auth/register",
    jsonRequest({ name: "Another User", email: "another@example.com", password: "VerySecure123" }),
    env,
  );
  assert.equal(plaintext.status, 422);
  assert.equal((await plaintext.json()).error.code, "password_verifier_required");
});

test("enabled Turnstile fails closed when its production secret is missing", async () => {
  const db = new MemoryD1();
  const response = await buildApp().request(
    "https://api.example.test/api/v1/auth/register",
    jsonRequest({
      name: "Mira Shah",
      email: "mira@example.com",
      passwordVerifier: "A".repeat(43),
      passwordKdf: "pbkdf2-sha256-v1",
    }),
    { DB: db, SESSION_SECRET, ENVIRONMENT: "production", TURNSTILE_ENABLED: "true" },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "human_verification_misconfigured");
  assert.equal(db.usersById.size, 0);
});

test("unsafe requests from an untrusted browser origin are blocked before state changes", async () => {
  const app = buildApp();
  const db = new MemoryD1();
  const response = await app.request(
    "https://api.example.test/api/v1/newsletter",
    jsonRequest(
      { email: "guest@example.com" },
      { headers: { "content-type": "application/json", origin: "https://attacker.example" } },
    ),
    environment(db),
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "cors_origin_denied");
  assert.equal(db.queries.length, 0);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("production does not trust localhost origins with credentialed CORS", async () => {
  const response = await buildApp().request(
    "https://melaiva.example/api/v1/newsletter",
    jsonRequest(
      { email: "guest@example.com" },
      { headers: { "content-type": "application/json", origin: "http://localhost:4173" } },
    ),
    { ENVIRONMENT: "production" },
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal((await response.json()).error.code, "cors_origin_denied");
});

test("CORS preflight reflects only configured origins and supports credentials", async () => {
  const app = buildApp();
  const env = { ...environment(), ALLOWED_ORIGINS: "https://app.example.test" };
  const response = await app.request(
    "https://api.example.test/api/v1/vendors/onboarding/evidence",
    {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.test",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "x-melaiva-vendor-evidence, cloudflare-workers-version-key",
      },
    },
    env,
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example.test");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.match(response.headers.get("access-control-allow-headers"), /X-Melaiva-Vendor-Evidence/u);
  assert.match(response.headers.get("access-control-allow-headers"), /Cloudflare-Workers-Version-Key/u);
  assert.match(response.headers.get("vary"), /Origin/);
});

test("development catalog degrades safely to curated fallback data when storage is absent", async () => {
  const app = buildApp();
  const response = await app.request(
    "https://api.example.test/api/v1/catalog/vendors?category=venues",
    {},
    { ENABLE_DEMO_CATALOG: "true", ENVIRONMENT: "development" },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.meta.source, "demo");
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].slug, "the-lakehouse-udaipur");
});

test("production catalog never fabricates vendors when storage is unavailable", async () => {
  const response = await buildApp().request("https://api.example.test/api/v1/catalog/vendors", {}, { ENVIRONMENT: "production" });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "catalog_unavailable");
  assert.doesNotMatch(JSON.stringify(payload), /Lakehouse|Moonlit|Gulmohar/);
});

test("catalog LIKE filters respect the Durable Object 50-byte UTF-8 limit", async () => {
  const app = buildApp();
  const env = environment();
  for (const search of ["x".repeat(49), "婚".repeat(17)]) {
    const response = await app.request(
      `https://api.example.test/api/v1/catalog/vendors?search=${encodeURIComponent(search)}`,
      {},
      env,
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_filter");
  }

  const boundary = await app.request(
    `https://api.example.test/api/v1/catalog/vendors?search=${"x".repeat(48)}`,
    {},
    env,
  );
  assert.equal(boundary.status, 200, await boundary.clone().text());
});

test("validation rejects unknown fields and never echoes sensitive input", async () => {
  const app = buildApp();
  const response = await app.request(
    "https://api.example.test/api/v1/auth/register",
    jsonRequest({
      name: "Aarav Mehta",
      email: "aarav@example.com",
      password: "VerySecure123",
      role: "admin",
    }),
    environment(),
  );

  assert.equal(response.status, 422);
  const text = await response.text();
  assert.match(text, /validation_failed/);
  assert.doesNotMatch(text, /VerySecure123/);
  assert.doesNotMatch(text, /SESSION_SECRET/);
});

test("AI planner requires authentication and returns a validated fallback without a Gemini key", async () => {
  const app = buildApp();
  const db = new MemoryD1();
  const env = environment(db);
  const unauthenticated = await app.request(
    "https://api.example.test/api/v1/planner/generate",
    jsonRequest({
      eventDate: "2027-12-15",
      city: "Jaipur",
      guestCount: 250,
      budget: 2500000,
      currency: "INR",
      style: "modern Indian garden",
      ceremonies: ["mehendi", "wedding"],
    }),
    env,
  );
  assert.equal(unauthenticated.status, 401);

  const registration = await app.request(
    "https://api.example.test/api/v1/auth/register",
    jsonRequest({ name: "Mira Shah", email: "mira@example.com", password: "StrongWedding123" }),
    env,
  );
  const cookie = registration.headers.get("set-cookie").split(";", 1)[0];
  const response = await app.request(
    "https://api.example.test/api/v1/planner/generate",
    jsonRequest(
      {
        eventDate: "2027-12-15",
        city: "Jaipur",
        guestCount: 250,
        budget: 2500000,
        currency: "INR",
        style: "modern Indian garden",
        ceremonies: ["mehendi", "wedding"],
        priorities: ["guest experience", "photography"],
      },
      { headers: { "content-type": "application/json", cookie } },
    ),
    env,
  );

  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.meta.source, "fallback");
  assert.equal(payload.meta.degraded, true);
  assert.equal(payload.data.budget.reduce((sum, item) => sum + item.percentage, 0), 100);
  assert.ok(payload.data.milestones.length >= 5);
});

test("combined Worker serves assets, preserves API JSON, and falls back to the SPA only for HTML navigation", async () => {
  const calls = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        calls.push(path);
        if (path === "/assets/app.js") return new Response("app", { status: 200, headers: { "content-type": "text/javascript" } });
        if (path === "/") return new Response("<!doctype html><main>Melaiva</main>", { status: 200, headers: { "content-type": "text/html" } });
        if (path === "/planning/checklist") return new Response(null, { status: 307, headers: { location: "/" } });
        return new Response("missing", { status: 404 });
      },
    },
  };

  const asset = await fetchWorker(new Request("https://melaiva.example/assets/app.js"), env, {});
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "app");
  assert.match(asset.headers.get("content-security-policy"), /default-src 'self'/);

  const route = await fetchWorker(
    new Request("https://melaiva.example/planning/checklist?source=share", { headers: { accept: "text/html" } }),
    env,
    {},
  );
  assert.equal(route.status, 200);
  assert.match(await route.text(), /Melaiva/);
  assert.deepEqual(calls, ["/assets/app.js", "/planning/checklist", "/"]);

  const api = await fetchWorker(
    new Request("https://melaiva.example/api/missing", { headers: { accept: "text/html" } }),
    env,
    {},
  );
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error.code, "not_found");
  assert.equal(calls.length, 3);
});
