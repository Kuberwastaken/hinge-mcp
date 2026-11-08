export type HingeSettings = {
  baseUrl: string;
  sendbirdAppId: string;
  sendbirdApiUrl: string;
  sendbirdWsUrl: string;
  sendbirdSdkVersion: string;
  hingeAppVersion: string;
  hingeBuildNumber: string;
  osVersion: string;
};

const DEFAULT_SENDBIRD_APP_ID = "3CDAD91C-1E0D-4A0D-BBEE-9671988BF9E9";

export function defaultSettings(overrides: Partial<HingeSettings> = {}): HingeSettings {
  const sendbirdAppId = overrides.sendbirdAppId ?? DEFAULT_SENDBIRD_APP_ID;
  const lowerAppId = sendbirdAppId.toLowerCase();
  return {
    baseUrl: "https://prod-api.hingeaws.net",
    sendbirdAppId,
    sendbirdApiUrl: `https://api-${lowerAppId}.sendbird.com`,
    sendbirdWsUrl: `wss://ws-${lowerAppId}.sendbird.com`,
    sendbirdSdkVersion: "4.26.0",
    // Local patch 2026-10-20: Hinge retired 9.91.0 (every call answered 426); 10.9.0 = App Store, 2026-10-19.
    hingeAppVersion: "10.9.0",
    hingeBuildNumber: "11639",
    osVersion: "26.0",
    ...overrides
  };
}
