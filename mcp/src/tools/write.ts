import type { McpServer } from "@modelcontextprotocol/server";
import type { HingeHttpMethod, Preferences } from "hinge-ts";
import { z } from "zod";
import type { HingeMcpContext } from "../client.js";
import { guarded, jsonResult } from "../result.js";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

/**
 * Tools that change the account. All are skipped when HINGE_MCP_READ_ONLY is
 * set, so a read-only server never advertises them.
 */
export function registerWriteTools(server: McpServer, context: HingeMcpContext): void {
  const { client, config } = context;
  if (config.readOnly) {
    return;
  }

  server.registerTool(
    "hinge_like",
    {
      title: "Like a profile",
      description: "Sends a like to a profile from hinge_recommendations, hinge_standouts, or hinge_likes_received. Liking someone who already liked you creates a match. Optionally attach a comment to a specific prompt (contentId + questionText + answerText) or a photo. Set useRose to spend a rose. Irreversible; confirm with the user first.",
      inputSchema: z.object({
        subjectId: z.string().regex(/^[A-Za-z0-9_-]{1,500}$/).describe("Target user id"),
        ratingToken: z.string().trim().min(1).max(500).describe("ratingToken that came with the subject"),
        comment: z.string().max(1000).optional().describe("Optional message attached to the like"),
        contentId: z.string().max(1000).optional().describe("contentId of the prompt or photo being liked"),
        questionText: z.string().max(1000).optional().describe("Prompt question being liked (with contentId)"),
        answerText: z.string().max(1000).optional().describe("Prompt answer being liked (with contentId)"),
        photoUrl: z.string().url().optional().describe("Photo url being liked instead of a prompt"),
        useRose: z.boolean().optional().describe("Spend a rose (superlike)"),
        origin: z.string().max(1000).optional().describe("Feed origin the subject came from (default compatibles)")
      }).strict(),
      annotations: WRITE
    },
    guarded(context, async ({ subjectId, ratingToken, comment, contentId, questionText, answerText, photoUrl, useRose, origin }) => {
      const result = await client.ratings.rateUser({
        subjectId,
        ratingToken,
        ...(comment ? { comment } : {}),
        ...(contentId ? { contentId } : {}),
        ...(questionText ? { questionText } : {}),
        ...(answerText ? { answerText } : {}),
        ...(photoUrl ? { photo: { url: photoUrl, ...(contentId ? { contentId } : {}) } } : {}),
        ...(useRose ? { useSuperlike: true } : {}),
        ...(origin ? { origin } : {})
      });
      return jsonResult({ status: "liked", subjectId, usedRose: Boolean(useRose), response: result });
    })
  );

  server.registerTool(
    "hinge_skip",
    {
      title: "Skip a profile",
      description: "Passes on a profile from hinge_recommendations or hinge_likes_received. The profile is removed from the feed. Irreversible; confirm with the user first.",
      inputSchema: z.object({
        subjectId: z.string().regex(/^[A-Za-z0-9_-]{1,500}$/).describe("Target user id"),
        ratingToken: z.string().trim().min(1).max(500).describe("ratingToken that came with the subject"),
        origin: z.string().max(1000).optional().describe("Feed origin the subject came from (default compatibles)")
      }).strict(),
      annotations: { ...WRITE, destructiveHint: true }
    },
    guarded(context, async ({ subjectId, ratingToken, origin }) => {
      const result = await client.ratings.skip({ subjectId, ratingToken, ...(origin ? { origin } : {}) });
      return jsonResult({ status: "skipped", subjectId, response: result });
    })
  );

  server.registerTool(
    "hinge_send_message",
    {
      title: "Send a chat message",
      description: "Sends a text message to a match. Pass the match's user id (subjectId from hinge_matches). Irreversible; confirm the exact text with the user first.",
      inputSchema: z.object({
        subjectId: z.string().regex(/^[A-Za-z0-9_-]{1,500}$/).describe("Match user id"),
        message: z.string().trim().min(1).max(500).max(4000).describe("Message text"),
        isFirstMessage: z.boolean().optional().describe("True when this opens the conversation (default: detected from chat history)")
      }).strict(),
      annotations: WRITE
    },
    guarded(context, async ({ subjectId, message, isFirstMessage }) => {
      await client.ensureSendbirdAuth();
      let first = isFirstMessage;
      let channelUrl: string | undefined;
      if (first === undefined) {
        try {
          channelUrl = (await client.chat.findDmWith(subjectId))?.channelUrl;
          first = channelUrl ? (await client.chat.messages({ channelUrl, messageTs: String(Date.now()), prevLimit: 1 })).messages.length === 0 : true;
        } catch {
          throw new Error("Could not determine chat state. Read the conversation and pass isFirstMessage explicitly.");
        }
      }
      const response = await client.chat.sendMessage({
        ays: false,
        matchMessage: Boolean(first),
        messageType: "text",
        messageData: { message },
        subjectId,
        origin: "connection"
      });
      return jsonResult({ status: "sent", subjectId, channelUrl: channelUrl ?? null, message, response });
    })
  );

  server.registerTool(
    "hinge_update_preferences",
    {
      title: "Update dating preferences",
      description: "Merges the given fields into the user's dating preferences and saves them. Read hinge_preferences first; fields not given are kept. Confirm with the user first.",
      inputSchema: z.object({
        preferences: z.record(z.string(), z.unknown()).describe("Partial preferences object using the same keys hinge_preferences returns (for example maxDistance, genderedAgeRanges, dealbreakers)")
      }).strict(),
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true }
    },
    guarded(context, async ({ preferences }) => {
      const current = await client.profiles.preferences();
      const merged = { ...current.preferences, ...(preferences as Partial<Preferences>) } as Preferences;
      const response = await client.profiles.updatePreferences(merged);
      return jsonResult({ status: "updated", preferences: merged, response });
    })
  );

  if (config.allowRaw) {
    server.registerTool(
      "hinge_raw_request",
      {
        title: "Raw Hinge or Sendbird request",
        description: "Escape hatch: performs an authenticated request against the Hinge REST API or the Sendbird chat API and returns the raw JSON. Only available when HINGE_MCP_ALLOW_RAW=1. Use with care.",
        inputSchema: z.object({
          service: z.enum(["hinge", "sendbird"]).describe("Which upstream API"),
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
          path: z.string().max(2000).regex(/^\/(?!\/)[^\\\s#]*$/).describe("Relative API path such as /likelimit or /user/v3; absolute URLs are rejected"),
          body: z.unknown().optional().describe("JSON body for write methods")
        }).strict(),
        annotations: { ...WRITE, destructiveHint: true }
      },
      guarded(context, async ({ service, method, path, body }) => {
        if (service === "sendbird") {
          await client.ensureSendbirdAuth();
        }
        const response = service === "hinge"
          ? await client.raw.hinge(method as HingeHttpMethod, path, body)
          : await client.raw.sendbird(method as HingeHttpMethod, path, body);
        return jsonResult(response);
      })
    );
  }
}
