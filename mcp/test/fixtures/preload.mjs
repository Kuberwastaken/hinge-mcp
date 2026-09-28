// Test process only. The production CLI has no endpoint-override environment variable.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const service =
    url.hostname === "prod-api.hingeaws.net"
      ? "hinge"
      : url.hostname.endsWith(".sendbird.com")
        ? "sendbird"
        : undefined;
  if (!service)
    throw new Error("Unexpected network destination in E2E fixture");
  return realFetch(
    `${process.env.HINGE_TEST_UPSTREAM}/${service}${url.pathname}${url.search}`,
    init,
  );
};
