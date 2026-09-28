import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { Client as ModernClient } from "@modelcontextprotocol/client";
import { StdioClientTransport as ModernStdio } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport as ModernHTTP } from "@modelcontextprotocol/client";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as LegacyStdio } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport as LegacyHTTP } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startUpstream } from "./fixtures/upstream.mjs";

const cli =
  process.env.HINGE_MCP_TEST_CLI ??
  fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const preload = new URL("./fixtures/preload.mjs", import.meta.url).href;

for (const era of ["2026-07-28", "legacy"])
  for (const mode of ["stdio", "http"]) {
    test(
      `real CLI end to end: ${era} over ${mode}`,
      { timeout: 30_000 },
      async (t) => {
        const dir = await mkdtemp(join(tmpdir(), "hinge-e2e-"));
        const upstream = await startUpstream();
        t.after(async () => {
          await upstream.close();
          await rm(dir, { recursive: true, force: true });
        });
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([k, v]) =>
              v !== undefined &&
              !k.startsWith("HINGE_") &&
              k !== "NODE_OPTIONS",
          ),
        );
        Object.assign(env, {
          HINGE_SESSION_FILE: join(dir, "session.json"),
          HINGE_PHONE_NUMBER: "+15555550123",
          HINGE_TEST_UPSTREAM: upstream.url,
          HINGE_MCP_DEBUG: "1",
        });
        const args = ["--import", preload, cli];
        let diagnostics = "",
          child;
        const current = era !== "legacy";
        const client = current
          ? new ModernClient(
              { name: "e2e", version: "1" },
              { versionNegotiation: { mode: { pin: era } } },
            )
          : new LegacyClient({ name: "e2e-legacy", version: "1" });
        t.after(async () => {
          await client.close();
          if (child) {
            child.kill();
            await new Promise((resolve) =>
              child.exitCode !== null ? resolve() : child.once("exit", resolve),
            );
          }
        });
        let transport;
        if (mode === "stdio") {
          const Transport = current ? ModernStdio : LegacyStdio;
          transport = new Transport({
            command: process.execPath,
            args,
            env,
            stderr: "pipe",
          });
          transport.stderr.on("data", (chunk) => {
            diagnostics += chunk;
          });
        } else {
          env.HINGE_MCP_TOKEN = "test-only-bearer-secret";
          child = spawn(process.execPath, [...args, "--http", "0"], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
          const url = await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("CLI HTTP startup timed out")),
              10_000,
            );
            child.once("exit", (code) => {
              clearTimeout(timer);
              reject(new Error(`CLI exited ${code}: ${diagnostics}`));
            });
            child.stderr.on("data", (chunk) => {
              diagnostics += chunk;
              const match = diagnostics.match(/listening on (http:\/\/[^\s]+)/);
              if (match) {
                clearTimeout(timer);
                resolve(match[1]);
              }
            });
          });
          const Transport = current ? ModernHTTP : LegacyHTTP;
          transport = new Transport(new URL(url), {
            requestInit: {
              headers: { authorization: `Bearer ${env.HINGE_MCP_TOKEN}` },
            },
          });
        }
        await client.connect(transport);
        const call = async (name, args = {}) => {
          const result = await client.callTool({ name, arguments: args });
          assert.notEqual(
            result.isError,
            true,
            `${name}: ${JSON.stringify(result)}; paths: ${upstream.requests
              .slice(-3)
              .map((r) => r.path)
              .join(", ")}`,
          );
          const json = JSON.parse(result.content[0].text);
          assert.deepEqual(result.structuredContent, json);
          assert.doesNotMatch(
            JSON.stringify(result),
            /fixture-hinge-secret|fixture-sendbird-secret/,
          );
          return json;
        };
        const tools = (await client.listTools()).tools;
        assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
        assert.equal((await call("hinge_session_status")).loggedIn, false);
        assert.equal((await call("hinge_login_start")).status, "otp_sent");
        const otp = await call("hinge_login_verify_otp", { otp: "123456" });
        assert.equal(otp.caseId, "case-e2e");
        assert.equal(
          (
            await call("hinge_login_verify_email", {
              caseId: otp.caseId,
              code: "654321",
            })
          ).status,
          "logged_in",
        );
        assert.equal((await call("hinge_session_status")).loggedIn, true);
        for (const name of [
          "hinge_me",
          "hinge_preferences",
          "hinge_recommendations",
          "hinge_standouts",
          "hinge_like_limit",
          "hinge_likes_received",
          "hinge_matches",
          "hinge_chats",
          "hinge_prompts_search",
        ])
          await call(name);
        await call("hinge_profiles", { userIds: ["1002"] });
        await call("hinge_match_detail", { subjectId: "1002" });
        await call("hinge_chat_messages", { partnerUserId: "1002" });
        const found = await call("search", { query: "matches Sam" });
        assert.equal(found.results[0].id, "match:1002");
        await call("fetch", { id: found.results[0].id });
        await call("fetch", { id: "chat:ch-1" });
        assert.equal((await client.listResources()).resources.length, 2);
        assert.equal(
          (await client.listResourceTemplates()).resourceTemplates.length,
          1,
        );
        await client.readResource({ uri: "hinge://usage" });
        await client.readResource({ uri: "hinge://session" });
        const profile = await client.readResource({
          uri: "hinge://profiles/1002",
        });
        assert.match(profile.contents[0].text, /Sam/);
        assert.equal((await client.listPrompts()).prompts.length, 2);
        await client.getPrompt({
          name: "review_profile",
          arguments: { focus: "prompts" },
        });
        await client.getPrompt({
          name: "draft_reply",
          arguments: { channelUrl: "ch-1" },
        });
        const completed = await client.complete({
          ref: { type: "ref/prompt", name: "draft_reply" },
          argument: { name: "tone", value: "fri" },
        });
        assert.deepEqual(completed.completion.values, ["friendly"]);
        await call("hinge_like", {
          subjectId: "1002",
          ratingToken: "rating-fixture",
        });
        await call("hinge_skip", {
          subjectId: "1002",
          ratingToken: "rating-fixture",
        });
        await call("hinge_send_message", {
          subjectId: "1002",
          message: "Fixture message only",
        });
        await call("hinge_update_preferences", {
          preferences: { maxDistance: 40 },
        });
        const saved = JSON.parse(
          await readFile(env.HINGE_SESSION_FILE, "utf8"),
        );
        assert.equal(saved.hingeAuth.token, "fixture-hinge-secret");
        await call("hinge_logout");
        assert.equal((await call("hinge_session_status")).loggedIn, false);
        await assert.rejects(readFile(env.HINGE_SESSION_FILE), {
          code: "ENOENT",
        });
        assert.equal(
          upstream.requests.filter((r) => r.path === "/hinge/rec/v2").length,
          1,
          "one recommendation request per tool call",
        );
        assert.equal(
          upstream.requests.filter((r) => r.path === "/hinge/message/send")
            .length,
          1,
          "no duplicate message sends",
        );
        assert.equal(
          upstream.requests.find(
            (r) => r.path === "/hinge/auth/device/validate",
          ).body.caseId,
          "case-e2e",
        );
        assert.doesNotMatch(
          diagnostics,
          /fixture-hinge-secret|fixture-sendbird-secret|123456|654321|Fixture message only/,
        );
      },
    );
  }
