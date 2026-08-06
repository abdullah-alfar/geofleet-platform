-- Runs once, automatically, on first container startup (docker-entrypoint-initdb.d).
-- Not a Laravel migration: this provisions the database-level extensions that
-- migrations depend on. Laravel migrations (Phase 2) assume these already exist.

-- Spatial types, operators, and GiST indexing for geography(Point, 4326) columns
-- used by driver locations, ride pickup/drop-off points, and trip routes.
CREATE EXTENSION IF NOT EXISTS postgis;

-- gen_random_uuid() is built into PostgreSQL core since v13 and needs no
-- extension. pgcrypto is enabled anyway for future hashing/HMAC needs
-- (e.g. token digests) without a second migration touching extensions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
