-- Critical Production Fixes: Vector Indexes and Optimizations
-- Run this AFTER initial Prisma migration

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For text search optimization
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- For better index types

-- =========================================
-- Vector Indexes for Fast Similarity Search
-- =========================================

-- Response Cache vector index (HNSW is fastest for high-dimensional vectors)
CREATE INDEX IF NOT EXISTS response_cache_vector_hnsw_idx 
ON response_caches 
USING hnsw (query_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Business FAQ vector index
CREATE INDEX IF NOT EXISTS business_faq_vector_hnsw_idx 
ON business_faqs 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Memory vector index
CREATE INDEX IF NOT EXISTS memories_vector_hnsw_idx 
ON memories 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- =========================================
-- Additional Performance Indexes
-- =========================================

-- Cost logs: Fast queries by business and date
CREATE INDEX IF NOT EXISTS cost_logs_business_date_idx 
ON cost_logs (business_id, created_at DESC);

-- Cost logs: Service type analytics
CREATE INDEX IF NOT EXISTS cost_logs_service_date_idx 
ON cost_logs (service, created_at DESC);

-- Messages: Conversation timeline
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx 
ON messages (conversation_id, created_at DESC);

-- Customers: Business lookup with last interaction
CREATE INDEX IF NOT EXISTS customers_business_last_interaction_idx 
ON customers (business_id, last_interaction DESC);

-- Abuse logs: IP address tracking
CREATE INDEX IF NOT EXISTS abuse_logs_ip_created_idx 
ON abuse_logs (ip_address, created_at DESC);

-- Abuse logs: Phone number tracking
CREATE INDEX IF NOT EXISTS abuse_logs_phone_created_idx 
ON abuse_logs (phone, created_at DESC) WHERE phone IS NOT NULL;

-- =========================================
-- Partitioning for Large Tables
-- =========================================

-- Messages table partitioning (by month)
-- Note: This requires recreating the table if it already has data
-- Run only on fresh database or during maintenance window

-- Create partitioned messages table (uncomment if setting up fresh)
/*
-- 1. Rename existing table
ALTER TABLE messages RENAME TO messages_old;

-- 2. Create partitioned table
CREATE TABLE messages (
  LIKE messages_old INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- 3. Create partitions for current and next 6 months
CREATE TABLE messages_2026_02 PARTITION OF messages
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE messages_2026_03 PARTITION OF messages
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE messages_2026_04 PARTITION OF messages
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE messages_2026_05 PARTITION OF messages
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE messages_2026_06 PARTITION OF messages
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE messages_2026_07 PARTITION OF messages
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- 4. Copy data from old table
INSERT INTO messages SELECT * FROM messages_old;

-- 5. Drop old table
DROP TABLE messages_old;
*/

-- =========================================
-- Database Configuration Optimization
-- =========================================

-- Increase shared_buffers for better caching (requires restart)
-- ALTER SYSTEM SET shared_buffers = '256MB';

-- Increase work_mem for complex queries
-- ALTER SYSTEM SET work_mem = '16MB';

-- Increase maintenance_work_mem for faster index creation
-- ALTER SYSTEM SET maintenance_work_mem = '256MB';

-- Enable parallel workers for faster queries
-- ALTER SYSTEM SET max_parallel_workers_per_gather = 4;

-- Reload configuration
-- SELECT pg_reload_conf();

-- =========================================
-- Useful Queries for Monitoring
-- =========================================

-- Check index sizes
-- SELECT 
--   schemaname,
--   tablename,
--   indexname,
--   pg_size_pretty(pg_relation_size(indexrelid)) as size
-- FROM pg_indexes
-- JOIN pg_class ON pg_class.relname = indexname
-- ORDER BY pg_relation_size(indexrelid) DESC;

-- Check table sizes
-- SELECT 
--   schemaname,
--   tablename,
--   pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check vector index effectiveness
-- SELECT 
--   relname,
--   indexrelname,
--   idx_scan as scans,
--   idx_tup_read as tuples_read,
--   idx_tup_fetch as tuples_fetched
-- FROM pg_stat_user_indexes
-- WHERE indexrelname LIKE '%vector%';

COMMIT;
