#!/bin/bash
set -euo pipefail

# Ops Agent: host CPU/mem/disk metrics + syslog/postgres logs → Cloud Monitoring.
# Runs on every boot; no-op once installed. Needs the VM service account.
if ! dpkg -l google-cloud-ops-agent >/dev/null 2>&1; then
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  bash add-google-cloud-ops-agent-repo.sh --also-install || true
fi

# Idempotent: startup scripts can run more than once.
if [ -f /var/lib/tryout-postgres-provisioned ]; then
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

# PGDG repo for Postgres 16 (Debian 12 ships 15) to match prod parity.
apt-get update
apt-get install -y curl ca-certificates gnupg
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y postgresql-16

PGCONF=/etc/postgresql/16/main
DB_PASSWORD='${db_password}'

# Create role + database (idempotent).
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='tryout'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE tryout LOGIN PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='tryout'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE tryout OWNER tryout;"

# Arena admin role: the arena runner's postgresql provider creates one database
# and one login role per buyer environment, so it needs CREATEDB + CREATEROLE —
# and nothing else. Not a superuser: it must not be able to read the tryout
# application database, which is why this is a separate role from 'tryout'.
ARENA_ADMIN_PASSWORD='${arena_admin_password}'
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='arena_admin'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE arena_admin LOGIN CREATEDB CREATEROLE PASSWORD '$ARENA_ADMIN_PASSWORD';"
sudo -u postgres psql -c "REVOKE ALL ON DATABASE tryout FROM arena_admin;"

# Listen on the VPC, allow only the subnet + connector ranges.
echo "listen_addresses = '*'" >> "$PGCONF/postgresql.conf"
{
  echo "host all all ${subnet_cidr} scram-sha-256"
  echo "host all all ${vpc_conn_cidr} scram-sha-256"
  echo "host all all 35.235.240.0/20 scram-sha-256" # IAP admin access
} >> "$PGCONF/pg_hba.conf"

systemctl restart postgresql
systemctl enable postgresql

touch /var/lib/tryout-postgres-provisioned
