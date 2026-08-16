# Running the platform without Docker

The repo-root `README.md` "Quick start" sections assume `docker compose up`
for Postgres/Redis/Kafka. This document is the alternative for developers
who want (or need) to run every piece of infrastructure and every service
natively on their own machine — no `docker-compose.yml` involved anywhere.

The approach: install Postgres/Redis/Kafka natively but configure them to
listen on the **exact same ports** `docker-compose.yml` maps them to on the
host (`55432`, `63790`, `9094`). Every service's `.env.example` already
points at those ports, so you copy each `.env.example` unmodified — nothing
in `apps/*` needs to know whether the thing on the other end of the
connection is a container or a native process.

Tested against Ubuntu/Debian (`apt`). The package names differ on other
distributions, but the Postgres/Redis/Kafka configuration itself is
identical anywhere.

## 1. Prerequisites

| Tool | Version | Used by |
|---|---|---|
| PHP | 8.4, with `pdo_pgsql` and `rdkafka` extensions | core-api |
| Composer | 2.x | core-api |
| Go | 1.26.3 | location-service, dispatch-service, realtime-gateway, `scripts/loadtest` |
| Node.js | 22.x | admin-api, admin-web, landing-web |
| PostgreSQL | 16, with PostGIS 3.4 | shared system of record |
| Redis | 7.x | live derived state (locations, presence, offers) |
| Apache Kafka | 3.9.x+ (KRaft mode — no Zookeeper) | the only inter-service event bus |
| Java (JRE) | 17+ | required to run Kafka itself |

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install -y php8.4-cli php8.4-pgsql php8.4-mbstring php8.4-xml \
  php8.4-curl composer golang-1.26 nodejs npm \
  postgresql-16 postgresql-16-postgis-3 redis-server openjdk-17-jre-headless
```

`rdkafka` isn't packaged by `apt` — it's a PECL extension that wraps the C
library `librdkafka` (the same library the Go services' `franz-go` and
core-api's `ext-rdkafka` both ultimately rely on, per
`apps/core-api/app/Infrastructure/Kafka/RdKafkaProducer.php`):

```bash
sudo apt install -y librdkafka-dev
sudo pecl install rdkafka
echo "extension=rdkafka.so" | sudo tee /etc/php/8.4/cli/conf.d/20-rdkafka.ini
php -m | grep rdkafka   # confirm it loaded
```

## 2. Infrastructure — Postgres, Redis, Kafka, all native

### Postgres + PostGIS

Point Postgres at port `55432` instead of the default `5432` — this is the
only infra config change needed anywhere, and it's what lets every app's
`.env.example` work unmodified (they all already say `DB_PORT=55432`,
mirroring `docker-compose.yml`'s host mapping).

```bash
sudo sed -i "s/^port = .*/port = 55432/" /etc/postgresql/16/main/postgresql.conf
sudo systemctl restart postgresql
```

Create the role, database, and PostGIS extensions (as the `postgres`
superuser — this mirrors what `infrastructure/postgres/init/001-extensions.sql`
does automatically inside the Postgres container on first boot):

```bash
sudo -u postgres psql -p 55432 <<'SQL'
CREATE ROLE core_api WITH LOGIN CREATEROLE PASSWORD 'change_me_local_dev';
CREATE DATABASE core_api OWNER core_api;
\c core_api
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

`core_api` needs `CREATEROLE` (not just table privileges) because
core-api's own migrations create four more least-privilege Postgres roles
at migrate time — `location_service`, `dispatch_service`,
`realtime_gateway`, `admin_api` (see e.g.
`apps/core-api/database/migrations/2026_08_06_150000_create_location_service_role.php`).
You never create those four roles by hand.

### Redis

Run a dedicated instance on `63790` with a password, separate from any
other Redis you might already have on the default port:

```bash
redis-server --port 63790 --requirepass change_me_local_dev --daemonize no
```

Leave that running in its own terminal (or `--daemonize yes` if you'd
rather not dedicate a terminal to it). `infrastructure/redis/redis.conf`
has the project's fuller local-dev config (AOF persistence, 256mb
maxmemory, allkeys-lru) if you want to pass `--include` that file too —
optional, the defaults are fine for local dev.

### Kafka (KRaft mode, single node)

Install to `/opt/kafka` — `infrastructure/kafka/init-topics.sh` (reused
below to create the topic catalog) hardcodes that path.

```bash
curl -fsSL https://downloads.apache.org/kafka/3.9.0/kafka_2.13-3.9.0.tgz -o /tmp/kafka.tgz
sudo tar -xzf /tmp/kafka.tgz -C /opt
sudo ln -s /opt/kafka_2.13-3.9.0 /opt/kafka
```

Write a local KRaft config listening on `9094` (matching every service's
`KAFKA_BOOTSTRAP_SERVERS=127.0.0.1:9094`):

```bash
cat > /opt/kafka/config/server-local.properties <<'EOF'
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@localhost:9093
listeners=PLAINTEXT://:9094,CONTROLLER://:9093
advertised.listeners=PLAINTEXT://127.0.0.1:9094
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
log.dirs=/opt/kafka/data
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
auto.create.topics.enable=false
EOF

KAFKA_CLUSTER_ID=$(/opt/kafka/bin/kafka-storage.sh random-uuid)
/opt/kafka/bin/kafka-storage.sh format -t "$KAFKA_CLUSTER_ID" -c /opt/kafka/config/server-local.properties
/opt/kafka/bin/kafka-server-start.sh /opt/kafka/config/server-local.properties
```

Leave that running in its own terminal too. In a new terminal, create the
platform's topic catalog using the repo's own script — this is the same
script `docker-compose.yml`'s `kafka-init` service runs, just pointed at
the native broker instead:

```bash
cd /var/www/html/geofleet-platform
KAFKA_BOOTSTRAP_SERVER=127.0.0.1:9094 bash infrastructure/kafka/init-topics.sh
```

### Verify infrastructure is up

```bash
psql -h 127.0.0.1 -p 55432 -U core_api -d core_api -c "SELECT postgis_full_version();"
redis-cli -p 63790 -a change_me_local_dev ping
/opt/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9094 --list
```

## 3. core-api (Laravel)

```bash
cd apps/core-api
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate          # also creates the 4 least-privilege roles above
php artisan admin:create you@example.com "Your Name" super_admin --password=ChangeMe123
php artisan serve --port=8000
```

core-api needs two more long-running processes, each in its own terminal
(same as the Docker-based quick start — nothing Docker-specific about
these, they were never containerized to begin with):

```bash
# Terminal: transactional outbox publisher — polls outbox_events, publishes to Kafka
watch -n 2 php artisan outbox:publish

# Terminal: location consumer — samples driver.location.validated.v1 into trip routes
php artisan kafka:consume-location-updates
```

Optional fourth terminal, only relevant once you've exercised the retry
path (see `docs/events/retry-and-dlq.md`):

```bash
php artisan kafka:consume-location-updates-retry
```

`GET http://localhost:8000/docs` renders the OpenAPI spec (Redoc,
local-only). See [apps/core-api/README.md](../apps/core-api/README.md) for
the full command list.

## 4. Go services

Each needs core-api's migrations applied first (they create the Postgres
role each service connects with). Run in this order — each is more useful
with the previous one already generating real data, though none of them
hard-fail without it.

```bash
# location-service
cd apps/location-service
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/location-service

# dispatch-service (new terminal)
cd apps/dispatch-service
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/dispatch-service

# realtime-gateway (new terminal)
cd apps/realtime-gateway
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/realtime-gateway
```

## 5. admin-api (NestJS)

```bash
cd apps/admin-api
cp .env.example .env
npm install
npm run start:dev
```

Requires core-api already running (login + the `admin:create` account from
step 3) — admin-api never talks to Kafka or to core-api's database
directly, only to core-api's own HTTP API (`CORE_API_BASE_URL` in
`.env.example`) and to Redis (for the realtime driver-map/counters
module). See [apps/admin-api/README.md](../apps/admin-api/README.md).

## 6. admin-web (Nuxt 4)

```bash
cd apps/admin-web
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000, log in with the account `admin:create` made in
step 3.

## 7. landing-web (Nuxt 4)

No backend dependency — pure static/client-side marketing site.

```bash
cd apps/landing-web
npm install
npm run dev
```

Open http://localhost:3002.

## 8. Running tests

None of these need Docker, and most don't need the infrastructure above
running either:

```bash
# core-api — PHPUnit against an in-memory SQLite DB (see phpunit.xml),
# no Postgres/Redis/Kafka required
cd apps/core-api && php artisan test

# Each Go service — pure unit tests, no live Postgres/Redis/Kafka required
cd apps/location-service && go test ./...
cd apps/dispatch-service && go test ./...
cd apps/realtime-gateway && go test ./...

# admin-api — Jest, permission-matching logic only; the
# Postgres-dependent auth path is verified live instead (see
# apps/admin-api/README.md's "Tests" section), not via a mocked-DB test
cd apps/admin-api && npm test

# admin-web / landing-web — no test suite; typecheck + lint are the
# equivalent quality gate
cd apps/admin-web && npm run typecheck && npm run lint
cd apps/landing-web && npm run typecheck && npm run lint
```

`scripts/loadtest` generates real traffic against the running stack and
diffs each service's own Prometheus metrics — not a test suite, but the
closest thing to an integration check across all of them at once:

```bash
cd scripts/loadtest
go run . -drivers=50 -customers=20 -gps-duration=30s
```

## 9. Stopping everything

Every process above runs in the foreground of its own terminal — `Ctrl+C`
each one. For the infrastructure:

```bash
# Kafka
# Ctrl+C the kafka-server-start.sh terminal, or:
/opt/kafka/bin/kafka-server-stop.sh

# Redis
# Ctrl+C the redis-server terminal, or if daemonized:
redis-cli -p 63790 -a change_me_local_dev shutdown

# Postgres — leave running (it's a systemd-managed system service, not
# something this project started); or `sudo systemctl stop postgresql`
# if you want it fully down.
```

## Troubleshooting

- **`could not find driver` / `pdo_pgsql not found`** — the `php8.4-pgsql`
  package wasn't installed, or you're running a different PHP CLI version
  than the one it installed for (`php -v` vs `php8.4 -v`).
- **`Class "RdKafka\Producer" not found`** — the `rdkafka.so` extension
  isn't loaded; re-check `php -m | grep rdkafka` and the `.ini` path for
  your actual `php --ini` config.
- **`FATAL: password authentication failed for user "core_api"`** — the
  password in `apps/core-api/.env`'s `DB_PASSWORD` must match what you set
  in the `CREATE ROLE` statement in step 2.
- **A Go service or admin-api can't reach Postgres/Redis/Kafka** — those
  services read the *other* app's `.env`-documented `*_PASSWORD` values
  (e.g. `LOCATION_SERVICE_DB_PASSWORD` in core-api's `.env` must match
  `LOCATION_SERVICE_POSTGRES_DSN`'s password in location-service's own
  `.env`) — see the comments in each `.env.example` for exactly which
  pairs must match.
- **Port already in use** — something else on your machine is already on
  `55432`/`63790`/`9094`/`8000`/`3000`/`3001`/`3002`/`8081`/`8082`/`8083`.
  `ss -tlnp | grep <port>` to find what.
