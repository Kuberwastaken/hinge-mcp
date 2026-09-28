import { z } from "zod";
const object = z.record(z.string(), z.unknown());
const objects = z.array(object);
// Describe stable server-owned envelopes; upstream payloads remain extensible.
export const OUTPUT_SCHEMAS = {
  hinge_session_status: z
    .object({
      loggedIn: z.boolean(),
      hasStoredToken: z.boolean(),
      readOnly: z.boolean(),
      validation: z.literal("local_expiry_only"),
    })
    .passthrough(),
  hinge_login_start: z.object({
    status: z.literal("otp_sent"),
    phoneNumber: z.string(),
    nextStep: z.string(),
  }),
  hinge_login_verify_otp: z
    .object({ status: z.enum(["logged_in", "email_verification_required"]) })
    .passthrough(),
  hinge_login_verify_email: z
    .object({
      status: z.literal("logged_in"),
      identityId: z.string(),
      sendbirdReady: z.boolean(),
    })
    .passthrough(),
  hinge_logout: z.object({
    status: z.literal("logged_out"),
    sessionFile: z.string(),
  }),
  hinge_me: z.object({
    userId: z.string().nullable(),
    profile: object.nullable(),
    content: object.nullable(),
  }),
  hinge_profiles: z.object({ profiles: objects, missing: z.array(z.string()) }),
  hinge_recommendations: z.object({ feeds: objects, subjects: objects }),
  hinge_likes_received: z.object({
    total: z.number().int(),
    likes: objects,
    nextOffset: z.number().int().nullable(),
  }),
  hinge_matches: z.object({
    total: z.number().int(),
    matches: objects,
    nextOffset: z.number().int().nullable(),
  }),
  hinge_match_detail: z.object({
    subjectId: z.string(),
    detail: z.unknown(),
    matchNote: z.unknown(),
    profile: object.nullable(),
  }),
  hinge_chats: z.object({ channels: objects }),
  hinge_chat_messages: z.object({
    channelUrl: z.string(),
    count: z.number().int(),
    messages: objects,
  }),
  hinge_prompts_search: z.object({ prompts: objects, categories: objects }),
  hinge_like: z.object({
    status: z.literal("liked"),
    subjectId: z.string(),
    usedRose: z.boolean(),
    response: z.unknown(),
  }),
  hinge_skip: z.object({
    status: z.literal("skipped"),
    subjectId: z.string(),
    response: z.unknown(),
  }),
  hinge_send_message: z.object({
    status: z.literal("sent"),
    subjectId: z.string(),
    channelUrl: z.string().nullable(),
    message: z.string(),
    response: z.unknown(),
  }),
  hinge_update_preferences: z.object({
    status: z.literal("updated"),
    preferences: object,
    response: z.unknown(),
  }),
  search: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string().optional(),
      }),
    ),
  }),
  fetch: z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    url: z.string().optional(),
    metadata: object.optional(),
  }),
};
