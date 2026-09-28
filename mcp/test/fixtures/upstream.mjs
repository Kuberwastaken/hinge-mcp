import { createServer } from "node:http";

export async function startUpstream() {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://localhost");
    requests.push({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      body: body ? JSON.parse(body) : null,
      headers: req.headers,
    });
    let status = 200,
      data;
    const path = url.pathname
      .replace(/^\/hinge/, "")
      .replace(/^\/sendbird\/v3/, "");
    const profile = (id) => ({
      user_id: id,
      profile: {
        first_name: id === "1001" ? "Me" : "Sam",
        age: 30,
        location: { name: "Austin" },
      },
    });
    const content = (id) => ({
      user_id: id,
      content: {
        answers: [
          { question: "A good Sunday", answer: "Hiking", content_id: "c1" },
        ],
        photos: [],
      },
    });
    const channel = {
      channel_url: "ch-1",
      members: [
        { user_id: "1001", nickname: "Me" },
        { user_id: "1002", nickname: "Sam" },
      ],
      unread_message_count: 1,
    };
    if (path === "/identity/install" || path === "/auth/sms/v2/initiate")
      data = {};
    else if (path === "/auth/sms/v2") {
      status = 412;
      data = { caseId: "case-e2e", email: "test@example.invalid" };
    } else if (path === "/auth/device/validate")
      data = {
        token: "fixture-hinge-secret",
        identity_id: "1001",
        expires: "2999-01-01T00:00:00Z",
      };
    else if (path === "/message/authenticate")
      data = {
        token: "fixture-sendbird-secret",
        expires: "2999-01-01T00:00:00Z",
      };
    else if (path === "/user/v3") data = profile("1001");
    else if (path === "/content/v2") data = content("1001");
    else if (path === "/user/v3/public")
      data = url.searchParams.get("ids").split(",").map(profile);
    else if (path === "/content/v2/public")
      data = url.searchParams.get("ids").split(",").map(content);
    else if (path === "/preference/v2/selected")
      data = { preferences: { max_distance: 30 } };
    else if (path === "/rec/v2")
      data = {
        feeds: [
          {
            id: 1,
            origin: "compatibles",
            subjects: [{ subject_id: "1002", rating_token: "rating-fixture" }],
          },
        ],
      };
    else if (path === "/likelimit") data = { likes: 8 };
    else if (path === "/like/v2")
      data = {
        likes: [
          { subject_id: "1002", rating: { rating_token: "rating-fixture" } },
        ],
      };
    else if (path === "/connection/v2")
      data = { connections: [{ subject_id: "1002", initiator_id: "1001" }] };
    else if (path.startsWith("/connection/")) data = { subject_id: "1002" };
    else if (/standout/.test(path)) data = { subjects: [] };
    else if (path === "/prompts")
      data = {
        prompts: [
          {
            id: "p1",
            prompt: "Sunday",
            placeholder: "",
            categories: ["about"],
            is_selectable: true,
          },
        ],
        categories: [{ slug: "about", is_visible: true }],
      };
    else if (path.includes("my_group_channels")) data = { channels: [channel] };
    else if (path === "/sdk/group_channels/ch-1") data = channel;
    else if (path === "/group_channels/ch-1/messages")
      data = {
        messages: [
          {
            message_id: "m1",
            message: "Hello",
            created_at: 1700000000000,
            user: { user_id: "1002", nickname: "Sam" },
          },
        ],
      };
    else if (path === "/rate/v2/initiate" || path === "/message/send")
      data = { ok: true };
    else if (path === "/flag/textreview") data = { hcm_run_id: "run1" };
    else {
      status = 404;
      data = { error: `fixture route missing: ${path}` };
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
