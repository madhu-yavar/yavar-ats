#!/usr/bin/env bash
# ATSIQ self-service deploy — no DevOps required.
#
# Usage:
#   scripts/deploy.sh [git-sha]     build <sha> (default: HEAD) and roll it out
#   scripts/deploy.sh migrate [sha] run drizzle/pg-migrations against prod DB
#
# What it does (build path proven 2026-09-30):
#   1. packs the committed tree (git archive) + the Capture companion zip
#   2. runs `bun install && bun run build` in a temporary oven/bun pod
#   3. pushes the runtime image with kaniko (Cloud Build is permission-blocked,
#      local Docker is unreliable — this path needs neither)
#   4. `kubectl set image` + rollout status + smoke checks
#
# Requires: gcloud + kubectl authenticated as madhu.r@yavar.ai (cluster RBAC
# and Artifact Registry write are on that account; never use the gmail one).
set -euo pipefail

PROJECT=yavar-studio
REGION=asia-south1
NS=atsiq
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/yavar-platform/atsiq"
REQUIRED_ACCOUNT="madhu.r@yavar.ai"
WORK="/tmp/atsiq-deploy-$$"
SHA="${2:-$(git rev-parse --short HEAD)}"
MODE="${1:-deploy}"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFAIL:\033[0m %s\n' "$*" >&2; exit 1; }
trap 'rm -rf "$WORK"; kubectl -n $NS delete pod atsiq-deploy-build atsiq-deploy-kaniko --ignore-not-found --wait=false >/dev/null 2>&1 || true' EXIT

# ---------------------------------------------------------------- guards
step "Guards"
cd "$(git rev-parse --show-toplevel)" || fail "not inside the atsiq git repository."
[ "$(gcloud config get-value account 2>/dev/null)" = "$REQUIRED_ACCOUNT" ] \
  || fail "gcloud account is not $REQUIRED_ACCOUNT (gcloud auth list)."
git diff --quiet HEAD -- drizzle/schema.ts 2>/dev/null || echo "  note: uncommitted schema changes exist — deploys ship committed code only."
kubectl -n "$NS" get deploy atsiq >/dev/null 2>&1 || fail "no kubectl access to deployment atsiq in namespace $NS."
IMAGE="$REGISTRY:$SHA"
echo "  account ok · cluster ok · target image: $IMAGE"

# ---------------------------------------------------------------- context
step "Packing build context (committed tree + companion zip)"
rm -rf "$WORK/ctx"
mkdir -p "$WORK/ctx"
git archive "$SHA" | tar -x -C "$WORK/ctx" 2>/dev/null || fail "cannot archive $SHA — is it committed/pushed?"
if [ ! -f "$WORK/ctx/public/atsiq-capture.zip" ]; then
  echo "  companion zip missing — rebuilding from extension/"
  ( cd extension && zip -qr "$WORK/ctx/public/atsiq-capture.zip" manifest.json background.js popup.js popup.html )
fi
tar -czf "$WORK/ctx.tgz" -C "$WORK/ctx" .
echo "  context: $(du -h "$WORK/ctx.tgz" | cut -f1)"

# ---------------------------------------------------------------- builder
step "Building the app in a temporary oven/bun pod"
kubectl -n "$NS" run atsiq-deploy-build --image=oven/bun:1 --restart=Never --overrides='{"spec":{"containers":[{"name":"atsiq-deploy-build","image":"oven/bun:1","command":["sleep","3600"],"resources":{"requests":{"cpu":"2","memory":"4Gi"},"limits":{"cpu":"4","memory":"8Gi"}}}],"restartPolicy":"Never"}}' >/dev/null
kubectl -n "$NS" wait --for=condition=Ready pod/atsiq-deploy-build --timeout=240s >/dev/null \
  || fail "builder pod never became ready."
kubectl -n "$NS" cp "$WORK/ctx.tgz" atsiq-deploy-build:/ctx.tgz >/dev/null 2>&1
kubectl -n "$NS" exec atsiq-deploy-build -- sh -c \
  'rm -rf /build && mkdir /build && tar -xzf /ctx.tgz -C /build 2>/dev/null; cd /build && bun install --frozen-lockfile >/dev/null 2>&1 && bun run build > build.log 2>&1' \
  || { kubectl -n "$NS" exec atsiq-deploy-build -- tail -20 /build/build.log; fail "app build failed — see the log above."; }
kubectl -n "$NS" exec atsiq-deploy-build -- sh -c 'cd /build && tar -czf /out.tgz .output' >/dev/null

# pull the artifact back (kubectl cp truncates occasionally — verify size)
EXPECT=$(kubectl -n "$NS" exec atsiq-deploy-build -- stat -c %s /out.tgz)
for i in 1 2 3; do
  kubectl -n "$NS" cp atsiq-deploy-build:/out.tgz "$WORK/out.tgz" >/dev/null 2>&1 || true
  [ "$(stat -f%z "$WORK/out.tgz" 2>/dev/null || stat -c%s "$WORK/out.tgz")" = "$EXPECT" ] && break
done
[ "$(stat -f%z "$WORK/out.tgz" 2>/dev/null || stat -c%s "$WORK/out.tgz")" = "$EXPECT" ] || fail "kubectl cp kept truncating the build output."
echo "  app build ok ($(du -h "$WORK/out.tgz" | cut -f1))"

# ---------------------------------------------------------------- image
step "Pushing the runtime image with kaniko"
mkdir -p "$WORK/img"
tar -xzf "$WORK/out.tgz" -C "$WORK/img"
cat > "$WORK/img/Dockerfile" <<'DOCKERFILE'
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY .output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
DOCKERFILE
tar -czf "$WORK/img.tgz" -C "$WORK/img" .
kubectl -n "$NS" run atsiq-deploy-kaniko --image=gcr.io/kaniko-project/executor:debug --restart=Never --overrides='{"spec":{"containers":[{"name":"atsiq-deploy-kaniko","image":"gcr.io/kaniko-project/executor:debug","command":["sleep","3600"],"resources":{"requests":{"cpu":"2","memory":"4Gi"},"limits":{"cpu":"4","memory":"12Gi"}}}],"restartPolicy":"Never"}}' >/dev/null
kubectl -n "$NS" wait --for=condition=Ready pod/atsiq-deploy-kaniko --timeout=240s >/dev/null \
  || fail "kaniko pod never became ready."
kubectl -n "$NS" cp "$WORK/img.tgz" atsiq-deploy-kaniko:/workspace/context.tgz >/dev/null 2>&1
kubectl -n "$NS" exec atsiq-deploy-kaniko -- sh -c 'cd /workspace && mkdir -p context && tar -xzf context.tgz -C context' >/dev/null
TOKEN=$(gcloud auth print-access-token)
kubectl -n "$NS" exec -i atsiq-deploy-kaniko -- sh -c "mkdir -p /kaniko/.docker && printf '%s' '{\"auths\":{\"$REGION-docker.pkg.dev\":{\"username\":\"oauth2accesstoken\",\"password\":\"$TOKEN\"}}}' > /kaniko/.docker/config.json" >/dev/null
kubectl -n "$NS" exec atsiq-deploy-kaniko -- /kaniko/executor \
  --context=dir:///workspace/context --dockerfile=Dockerfile \
  --destination="$IMAGE" --snapshot-mode=redo --verbosity=warn \
  || fail "kaniko build/push failed."
echo "  pushed $IMAGE"

# ---------------------------------------------------------------- migrate
if [ "$MODE" = "migrate" ]; then
  step "Running drizzle/pg-migrations against the prod database"
  DBURL=$(kubectl -n "$NS" get secret atsiq-env -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
  kubectl -n "$NS" exec -i atsiq-deploy-build -- env DATABASE_URL="$DBURL" sh -c \
    'cd /build && node scripts/migrate-pg.mjs' \
    || fail "migration run failed."
  echo "  migrations applied (idempotent — already-applied files skipped)."
fi

# ---------------------------------------------------------------- rollout
if [ "$MODE" = "deploy" ]; then
  step "Rolling out"
  PREV=$(kubectl -n "$NS" get deploy atsiq -o jsonpath='{.spec.template.spec.containers[0].image}')
  kubectl -n "$NS" set image deploy/atsiq atsiq="$IMAGE"
  kubectl -n "$NS" rollout status deploy/atsiq --timeout=300s \
    || { echo "Rollout failed — rolling back:"; kubectl -n "$NS" set image deploy/atsiq atsiq="$PREV"; kubectl -n "$NS" rollout status deploy/atsiq --timeout=300s; fail "rolled back to $PREV."; }
  echo "  previous image (rollback if needed): $PREV"
fi

# ---------------------------------------------------------------- smoke
step "Smoke checks"
sleep 5
BASE=$(kubectl -n "$NS" get secret atsiq-env -o jsonpath='{.data.PUBLIC_SITE_URL}' | base64 -d)
curl -sf -o /dev/null "$BASE/" && echo "  app: 200" || fail "app not serving at $BASE"
curl -s -o /dev/null -w "  board webhook guard: HTTP %{http_code}\n" -X POST "$BASE/api/public/boards/indeed/probe_token_12345678"
step "DONE — $SHA is live at $BASE"
