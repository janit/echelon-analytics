// Echelon Analytics — Shared Types

export interface ViewRecord {
  visitor_id: string;
  path: string;
  site_id: string;
  session_id: string | null;
  interaction_ms: number | null;
  screen_width: number | null;
  screen_height: number | null;
  device_type: string | null;
  os_name: string | null;
  country_code: string | null;
  is_returning: number;
  referrer: string | null;
  referrer_type: string;
  bot_score: number;
  is_pwa: number;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

export interface SemanticEvent {
  event_type: string;
  site_id: string;
  session_id: string | null;
  visitor_id: string | null;
  data: string | null;
  experiment_id?: string | null;
  variant_id?: string | null;
  utm_campaign?: string | null;
  device_type: string;
  referrer: string | null;
  hour: number;
  month: number;
  day_of_week: number;
  is_returning: number;
  bot_score: number;
}

export interface ExperimentRow {
  experiment_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  metric_event_type: string;
  allocation_percent: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface ExperimentVariantRow {
  experiment_id: string;
  variant_id: string;
  name: string;
  weight: number;
  is_control: number;
  config: string | null;
}

export interface UtmCampaignRow {
  id: string;
  name: string;
  utm_campaign: string;
  site_id: string;
  status: "active" | "paused" | "archived";
  created_at: string;
}

export interface BotScoreSignals {
  interactionMs?: number;
  burstCount: number;
  hasAcceptLanguage: boolean;
  hasSecChUa: boolean;
  hasSecFetchSite: boolean;
  screenWidth?: number;
  screenHeight?: number;
  referrer?: string;
  path?: string;
  visitorCountry?: string;
  siteId?: string;
  /** Cloudflare bot score (1=bot, 99=human). Auto-detected from cf-bot-score header. */
  cfBotScore?: number;
  /** Cloudflare verified bot flag. Auto-detected from cf-verified-bot header. */
  cfVerifiedBot?: boolean;
}

export interface PerfMetric {
  category: string;
  metric: string;
  value: number;
  unit: string;
  commit_hash?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
}

export interface PerfMetricRow {
  id: number;
  recorded_at: string;
  commit_hash: string | null;
  branch: string | null;
  category: string;
  metric: string;
  value: number;
  unit: string;
  metadata: string | null;
}

export interface DailySummary {
  date: string;
  total_events: number;
  unique_sessions: number;
  top_paths: { path: string; count: number }[];
  top_event_types: { event_type: string; count: number }[];
  device_breakdown: { device_class: string; sessions: number }[];
}

export interface ExperimentStats {
  experiment_id: string;
  name: string;
  status: string;
  metric_event_type: string;
  variants: VariantStats[];
}

export interface VariantStats {
  variant_id: string;
  name: string;
  is_control: boolean;
  impressions: number;
  conversions: number;
  conversion_rate: number;
  relative_uplift: number | null;
  significance: string;
}

export interface SessionContext {
  session_id: string;
  viewport_width: number;
  viewport_height: number;
  screen_width: number;
  screen_height: number;
  device_pixel_ratio: number;
  device_class: "mobile" | "tablet" | "desktop";
  user_agent: string;
  language: string;
  timezone_offset_min: number;
  connection_type: string | null;
}

export interface EventPayload {
  event_id: string;
  type: string;
  ts: string;
  hi_res_ts?: number;
  path?: string;
  referrer?: string;
  experiments?: { experiment_id: string; variant_id: string }[];
  data?: Record<string, unknown>;
}

export interface IngestBatch {
  v: number;
  batch_id: string;
  sent_at: string;
  context: SessionContext;
  events: EventPayload[];
}

export interface IngestResult {
  accepted: number;
  duplicate: number;
}
