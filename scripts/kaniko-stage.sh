#!/bin/sh
# Runs INSIDE the deploy builder pod (oven/bun): stages the minimal runtime
# image context and fetches the kaniko executor binary. Invoked by
# scripts/deploy.sh with env: KASSET (kaniko release asset name).
set -e
mkdir -p /outimg /outimg/.docker
tar -xzf /out.tgz -C /outimg
cat > /outimg/Dockerfile <<'DOCKERFILE'
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY .output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
DOCKERFILE
for asset in executor_linux_amd64 executor; do
  for i in 1 2 3; do
    KASSET="$asset" bun -e "await Bun.write('/kaniko-exec', new Uint8Array(await (await fetch('https://github.com/GoogleContainerTools/kaniko/releases/download/v1.23.2/' + process.env.KASSET)).arrayBuffer()))" || { sleep 3; continue; }
    [ "$(head -c 4 /kaniko-exec | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] && break 2
    sleep 3
  done
done
[ "$(head -c 4 /kaniko-exec | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || { echo "kaniko binary download failed (not an ELF binary)" >&2; exit 1; }
chmod +x /kaniko-exec
echo "image context ready"
