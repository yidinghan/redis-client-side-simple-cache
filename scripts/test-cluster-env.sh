#!/usr/bin/env bash
set -euo pipefail

CONTAINER_ENGINE=${CONTAINER_ENGINE:-docker}
REDIS_IMAGE=${REDIS_IMAGE:-redis:7-alpine}
CONTAINER_NAME=redis-simple-csc-test-cluster

case "${1:-}" in
  down)
    if "$CONTAINER_ENGINE" container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      "$CONTAINER_ENGINE" rm --force --volumes "$CONTAINER_NAME"
    fi
    exit 0
    ;;
  up) ;;
  *) echo "Usage: $0 up|down" >&2; exit 2 ;;
esac

if "$CONTAINER_ENGINE" container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Container already exists; run '$0 down' first: $CONTAINER_NAME" >&2
  exit 1
fi

# Create first so a failed start (for example, occupied ports) is also cleaned up.
container_id=$("$CONTAINER_ENGINE" create --name "$CONTAINER_NAME" \
  --publish 127.0.0.1:16379:16379 --publish 127.0.0.1:16380:16380 \
  --publish 127.0.0.1:16381:16381 "$REDIS_IMAGE" sh -ec '
    for redis_port in 16379 16380 16381; do
      redis-server --port "$redis_port" --bind 0.0.0.0 --protected-mode no \
        --cluster-enabled yes --cluster-config-file "/tmp/nodes-${redis_port}.conf" \
        --cluster-node-timeout 5000 --cluster-announce-ip 127.0.0.1 \
        --cluster-announce-port "$redis_port" \
        --cluster-announce-bus-port "$((redis_port + 10000))" \
        --appendonly no --save "" --maxmemory-policy noeviction &
    done
    wait
  ')
trap '"$CONTAINER_ENGINE" logs --tail 60 "$container_id" >&2 || true; "$CONTAINER_ENGINE" rm --force --volumes "$container_id" >/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$CONTAINER_ENGINE" start "$container_id"

for attempt in {1..30}; do
  if "$CONTAINER_ENGINE" exec "$container_id" timeout 5 sh -ec '
    for redis_port in 16379 16380 16381; do
      [ "$(redis-cli -p "$redis_port" ping)" = PONG ]
    done
  ' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = 30 ]; then echo 'Redis startup check failed' >&2; exit 1; fi
  sleep 1
done

"$CONTAINER_ENGINE" exec "$container_id" timeout 30 redis-cli --cluster create \
  127.0.0.1:16379 127.0.0.1:16380 127.0.0.1:16381 --cluster-replicas 0 --cluster-yes
for attempt in {1..30}; do
  if "$CONTAINER_ENGINE" exec "$container_id" timeout 5 sh -ec '
    for redis_port in 16379 16380 16381; do
      redis-cli -p "$redis_port" cluster info | grep -q "^cluster_state:ok"
    done
  ' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = 30 ]; then echo 'Redis Cluster readiness check failed' >&2; exit 1; fi
  sleep 1
done

trap - EXIT INT TERM
echo 'Redis Cluster ready: redis://127.0.0.1:16379,redis://127.0.0.1:16380,redis://127.0.0.1:16381'
