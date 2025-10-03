/**
 * Database Model Types
 * Concrete type definitions for database entities and operations
 */

import type { DatabaseRow, DatabaseResult } from './api-types';

// Base Database Types
export interface BaseEntity {
  id: string | number;
  created_at: Date;
  updated_at: Date;
}

export interface SoftDeletableEntity extends BaseEntity {
  deleted_at: Date | null;
}

// Message Related Types
export interface MessageRecord extends BaseEntity {
  message_id: number;
  chat_id: number;
  user_id: number | null;
  date: Date;
  text: string | null;
  message_type: MessageType;
  reply_to_message_id: number | null;
  forward_from_chat_id: number | null;
  forward_from_message_id: number | null;
  media_group_id: string | null;
  has_media: boolean;
  entities: MessageEntityRecord[] | null;
  raw_data: string; // JSON string of original Telegram message
}

export type MessageType = 
  | 'text'
  | 'photo'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'animation'
  | 'location'
  | 'contact'
  | 'poll'
  | 'dice'
  | 'game'
  | 'invoice'
  | 'successful_payment'
  | 'connected_website'
  | 'passport_data'
  | 'proximity_alert_triggered'
  | 'video_chat_started'
  | 'video_chat_ended'
  | 'video_chat_participants_invited'
  | 'video_chat_scheduled'
  | 'message_auto_delete_timer_changed'
  | 'migrate_to_chat_id'
  | 'migrate_from_chat_id'
  | 'pinned_message'
  | 'new_chat_members'
  | 'left_chat_member'
  | 'new_chat_title'
  | 'new_chat_photo'
  | 'delete_chat_photo'
  | 'group_chat_created'
  | 'supergroup_chat_created'
  | 'channel_chat_created';

export interface MessageEntityRecord {
  type: MessageEntityType;
  offset: number;
  length: number;
  url?: string;
  user_id?: number;
  language?: string;
}

export type MessageEntityType =
  | 'mention'
  | 'hashtag'
  | 'cashtag'
  | 'bot_command'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'pre'
  | 'text_link'
  | 'text_mention';

// Chat Related Types
export interface ChatRecord extends BaseEntity {
  chat_id: number;
  type: ChatType;
  title: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  description: string | null;
  invite_link: string | null;
  pinned_message_id: number | null;
  permissions: ChatPermissions | null;
  slow_mode_delay: number | null;
  message_auto_delete_time: number | null;
  has_protected_content: boolean;
  sticker_set_name: string | null;
  can_set_sticker_set: boolean;
  linked_chat_id: number | null;
  location: ChatLocation | null;
  is_active: boolean;
  last_message_date: Date | null;
  member_count: number | null;
}

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface ChatPermissions {
  can_send_messages: boolean;
  can_send_media_messages: boolean;
  can_send_polls: boolean;
  can_send_other_messages: boolean;
  can_add_web_page_previews: boolean;
  can_change_info: boolean;
  can_invite_users: boolean;
  can_pin_messages: boolean;
  can_manage_topics: boolean;
}

export interface ChatLocation {
  location: {
    longitude: number;
    latitude: number;
  };
  address: string;
}

// User Related Types
export interface UserRecord extends BaseEntity {
  user_id: number;
  is_bot: boolean;
  first_name: string;
  last_name: string | null;
  username: string | null;
  language_code: string | null;
  is_premium: boolean;
  added_to_attachment_menu: boolean;
  can_join_groups: boolean;
  can_read_all_group_messages: boolean;
  supports_inline_queries: boolean;
  last_seen: Date | null;
  is_active: boolean;
}

// Statistics Types
export interface StatisticsRecord extends BaseEntity {
  chat_id: number;
  date: Date;
  message_count: number;
  user_count: number;
  media_count: number;
  forward_count: number;
  reply_count: number;
  edit_count: number;
  delete_count: number;
  join_count: number;
  leave_count: number;
  most_active_hour: number;
  most_active_user_id: number | null;
  top_words: string[] | null; // JSON array
  sentiment_score: number | null;
  activity_score: number;
}

export interface UserStatisticsRecord extends BaseEntity {
  user_id: number;
  chat_id: number;
  date: Date;
  message_count: number;
  character_count: number;
  word_count: number;
  media_count: number;
  forward_count: number;
  reply_count: number;
  mention_count: number;
  hashtag_count: number;
  url_count: number;
  first_message_time: Date | null;
  last_message_time: Date | null;
  most_active_hour: number;
  sentiment_score: number | null;
  profanity_count: number;
  violation_count: number;
}

// Criminal Code Analysis Types
export interface CriminalCodeRecord extends BaseEntity {
  article_number: string;
  title: string;
  content: string;
  category: CriminalCodeCategory;
  severity: CriminalCodeSeverity;
  keywords: string[]; // JSON array
  related_articles: string[]; // JSON array
  is_active: boolean;
  last_updated: Date;
}

export type CriminalCodeCategory =
  | 'crimes_against_person'
  | 'crimes_against_property'
  | 'crimes_against_public_order'
  | 'crimes_against_state'
  | 'economic_crimes'
  | 'drug_crimes'
  | 'traffic_violations'
  | 'administrative_violations'
  | 'other';

export type CriminalCodeSeverity = 'minor' | 'moderate' | 'serious' | 'severe';

export interface ViolationRecord extends BaseEntity {
  message_id: number;
  chat_id: number;
  user_id: number;
  article_number: string;
  violation_type: ViolationType;
  severity: CriminalCodeSeverity;
  confidence_score: number;
  context: string;
  detected_keywords: string[]; // JSON array
  ai_analysis: string | null;
  human_reviewed: boolean;
  human_reviewer_id: number | null;
  review_date: Date | null;
  review_notes: string | null;
  status: ViolationStatus;
  false_positive: boolean;
}

export type ViolationType =
  | 'profanity'
  | 'hate_speech'
  | 'threat'
  | 'harassment'
  | 'spam'
  | 'fraud'
  | 'illegal_content'
  | 'copyright_violation'
  | 'privacy_violation'
  | 'other';

export type ViolationStatus = 'pending' | 'confirmed' | 'dismissed' | 'escalated';

// Notification Types
export interface NotificationRecord extends BaseEntity {
  recipient_id: number;
  chat_id: number | null;
  type: NotificationType;
  title: string;
  message: string;
  data: NotificationData | null; // JSON object
  priority: NotificationPriority;
  status: NotificationStatus;
  scheduled_for: Date | null;
  sent_at: Date | null;
  read_at: Date | null;
  expires_at: Date | null;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
}

export type NotificationType =
  | 'violation_detected'
  | 'daily_summary'
  | 'weekly_report'
  | 'system_alert'
  | 'user_mention'
  | 'chat_activity'
  | 'moderation_action'
  | 'security_alert'
  | 'maintenance_notice'
  | 'feature_announcement';

export interface NotificationData {
  violation_id?: string;
  article_number?: string;
  severity?: CriminalCodeSeverity;
  message_preview?: string;
  action_url?: string;
  metadata?: Record<string, unknown>;
}

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled';

// Activity Tracking Types
export interface ActivityRecord extends BaseEntity {
  user_id: number;
  chat_id: number;
  activity_type: ActivityType;
  activity_data: ActivityData | null; // JSON object
  timestamp: Date;
  session_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  duration: number | null; // in seconds
}

export type ActivityType =
  | 'message_sent'
  | 'message_edited'
  | 'message_deleted'
  | 'chat_joined'
  | 'chat_left'
  | 'user_banned'
  | 'user_unbanned'
  | 'user_promoted'
  | 'user_demoted'
  | 'settings_changed'
  | 'file_uploaded'
  | 'file_downloaded'
  | 'search_performed'
  | 'report_generated'
  | 'violation_reviewed';

export interface ActivityData {
  message_id?: number;
  target_user_id?: number;
  old_value?: unknown;
  new_value?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Configuration Types
export interface ConfigurationRecord extends BaseEntity {
  key: string;
  value: ConfigurationValue;
  type: ConfigurationType;
  description: string | null;
  is_sensitive: boolean;
  is_system: boolean;
  validation_rules: ValidationRule[] | null; // JSON array
  last_modified_by: number | null;
}

export type ConfigurationValue = string | number | boolean | object | null;
export type ConfigurationType = 'string' | 'number' | 'boolean' | 'json' | 'array';

export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'pattern' | 'enum' | 'custom';
  value?: unknown;
  message?: string;
}

// Audit Log Types
export interface AuditLogRecord extends BaseEntity {
  user_id: number | null;
  action: AuditAction;
  resource_type: string;
  resource_id: string | null;
  old_values: Record<string, unknown> | null; // JSON object
  new_values: Record<string, unknown> | null; // JSON object
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  success: boolean;
  error_message: string | null;
  metadata: Record<string, unknown> | null; // JSON object
}

export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'password_change'
  | 'permission_change'
  | 'configuration_change'
  | 'data_export'
  | 'data_import'
  | 'system_maintenance'
  | 'security_event';

// Query Builder Types
export interface QueryOptions {
  select?: string[];
  where?: WhereClause[];
  orderBy?: OrderByClause[];
  groupBy?: string[];
  having?: WhereClause[];
  limit?: number;
  offset?: number;
  joins?: JoinClause[];
}

export interface WhereClause {
  column: string;
  operator: WhereOperator;
  value: unknown;
  logical?: 'AND' | 'OR';
}

export type WhereOperator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';

export interface OrderByClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface JoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  table: string;
  on: string;
}

// Migration Types
export interface MigrationRecord extends BaseEntity {
  version: string;
  name: string;
  up_sql: string;
  down_sql: string;
  executed_at: Date | null;
  execution_time: number | null; // in milliseconds
  success: boolean;
  error_message: string | null;
  checksum: string;
}

// Backup Types
export interface BackupRecord extends BaseEntity {
  name: string;
  type: BackupType;
  size: number; // in bytes
  compressed_size: number | null; // in bytes
  file_path: string;
  checksum: string;
  encryption_key_id: string | null;
  metadata: BackupMetadata | null; // JSON object
  status: BackupStatus;
  started_at: Date;
  completed_at: Date | null;
  error_message: string | null;
}

export type BackupType = 'full' | 'incremental' | 'differential' | 'transaction_log';
export type BackupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackupMetadata {
  tables: string[];
  row_counts: Record<string, number>;
  schema_version: string;
  application_version: string;
  environment: string;
  retention_policy: string;
}

// Performance Monitoring Types
export interface PerformanceMetricRecord extends BaseEntity {
  metric_name: string;
  metric_type: MetricType;
  value: number;
  unit: string;
  tags: Record<string, string> | null; // JSON object
  timestamp: Date;
  source: string;
  environment: string;
}

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer' | 'rate';

// Health Check Types
export interface HealthCheckRecord extends BaseEntity {
  service_name: string;
  check_name: string;
  status: HealthStatus;
  response_time: number; // in milliseconds
  error_message: string | null;
  details: Record<string, unknown> | null; // JSON object
  timestamp: Date;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

// Generic Database Operation Types
export interface DatabaseTransaction {
  id: string;
  queries: DatabaseQuery[];
  rollback?: () => Promise<void>;
  commit?: () => Promise<void>;
}

export interface DatabaseQuery {
  sql: string;
  params?: unknown[];
  timeout?: number;
}

export interface DatabaseConnection {
  execute<T = DatabaseRow>(query: string, params?: unknown[]): Promise<DatabaseResult<T>>;
  transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Utility Types for Database Operations
export type CreateInput<T extends BaseEntity> = Omit<T, 'id' | 'created_at' | 'updated_at'>;
export type UpdateInput<T extends BaseEntity> = Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>;
export type DatabaseId = string | number;

// Repository Interface Types
export interface Repository<T extends BaseEntity> {
  create(data: CreateInput<T>): Promise<T>;
  findById(id: DatabaseId): Promise<T | null>;
  findMany(options?: QueryOptions): Promise<T[]>;
  update(id: DatabaseId, data: UpdateInput<T>): Promise<T>;
  delete(id: DatabaseId): Promise<boolean>;
  count(options?: QueryOptions): Promise<number>;
}

export interface SoftDeleteRepository<T extends SoftDeletableEntity> extends Repository<T> {
  softDelete(id: DatabaseId): Promise<boolean>;
  restore(id: DatabaseId): Promise<boolean>;
  findWithDeleted(options?: QueryOptions): Promise<T[]>;
  findOnlyDeleted(options?: QueryOptions): Promise<T[]>;
}

// Type Guards for Database Results
export function isDatabaseRow(value: unknown): value is DatabaseRow {
  return typeof value === 'object' && value !== null;
}

export function isDatabaseResult<T>(value: unknown): value is DatabaseResult<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'results' in value &&
    'success' in value &&
    'meta' in value &&
    Array.isArray((value as DatabaseResult<T>).results)
  );
}