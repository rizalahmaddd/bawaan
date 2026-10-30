export const FEATURES = ["email", "apple", "courier", "domains", "qris", "wa_cloud", "platform_gateway"] as const;
export type Feature = (typeof FEATURES)[number];

/**
 * Third-party integrations stay off until listed in the FEATURES var (comma-separated), even when
 * their secrets are set. Lets us launch without them and switch each on without a code change.
 */
export function feature(env: Env, name: Feature): boolean {
  return (env.FEATURES ?? "")
    .split(",")
    .map((f) => f.trim())
    .includes(name);
}
