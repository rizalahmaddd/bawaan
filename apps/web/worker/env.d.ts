// Optional integrations. Each feature stays off until its secrets are set (wrangler secret put …).
interface Env {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  CUSTOM_DOMAIN_TARGET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  BITESHIP_API_KEY?: string;
  PLATFORM_ADMINS?: string;
  PLATFORM_XENDIT_KEY?: string;
  PLATFORM_XENDIT_CALLBACK_TOKEN?: string;
}
