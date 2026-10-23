#!/usr/bin/env bash
# 一键起 web dev：本地 sqld(127.0.0.1:8081) + vite dev(localhost:3000)
# 用法：./dev.sh [--push]   （--push 在启动前强制执行一次 drizzle-kit push）
set -euo pipefail
cd "$(dirname "$0")"

SQLD_LOG=/tmp/notion-clone-web-sqld.log
sqld_pid=
fresh=0
want_push=0
if [ "${1:-}" = "--push" ]; then want_push=1; fi

# vite 8 跑不了系统 node 20（缺 util.styleText）；优先 nvm 的 node 24，没有就退回 Bun 运行时
node24=$(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$node24" ] && [ -x "$node24/bin/node" ]; then
  export PATH="$node24/bin:$HOME/.bun/bin:$HOME/.turso:$PATH"
  vite() { ./node_modules/.bin/vite "$@"; }
  pkg_run() { bun run "$@"; }
else
  export PATH="$HOME/.bun/bin:$HOME/.turso:$PATH"
  vite() { bun --bun ./node_modules/.bin/vite "$@"; }
  pkg_run() { bun --bun run "$@"; }
fi

command -v bun >/dev/null 2>&1 || { echo "错误：需要 bun（https://bun.sh）"; exit 1; }

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# npmmirror 在 bun 下偶发证书校验错误，固定走官方源
if [ ! -d node_modules/vite ]; then
  echo "==> 安装依赖（bun install）"
  bun install --registry https://registry.npmjs.org
fi

cleanup() {
  if [ -n "$sqld_pid" ]; then
    kill "$sqld_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if port_busy 8081; then
  echo "==> 复用已在运行的 sqld（端口 8081）"
else
  if [ ! -f dev-local.db ]; then fresh=1; fi
  echo "==> 启动本地 sqld（端口 8081，数据文件 dev-local.db）"
  turso dev --port 8081 --db-file dev-local.db >"$SQLD_LOG" 2>&1 &
  sqld_pid=$!
  tries=0
  until curl -s -o /dev/null http://127.0.0.1:8081; do
    if ! kill -0 "$sqld_pid" 2>/dev/null; then
      echo "错误：sqld 启动失败："
      tail -n 20 "$SQLD_LOG"
      exit 1
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 50 ]; then
      echo "错误：sqld 10s 内未就绪："
      tail -n 20 "$SQLD_LOG"
      exit 1
    fi
    sleep 0.2
  done
fi

# 新建库或显式 --push 时建表；.dev.vars 提供 TURSO_DATABASE_URL
if [ "$fresh" = 1 ] || [ "$want_push" = 1 ]; then
  echo "==> 同步数据库表（drizzle-kit push）"
  set -a
  # shellcheck disable=SC1091
  source .dev.vars
  set +a
  pkg_run db:push
fi

if port_busy 3000; then
  echo "错误：端口 3000 已被占用。BETTER_AUTH_URL 固定指向 3000，vite 被迫换端口会导致登录回调失效，请先释放端口。"
  exit 1
fi

echo "==> web dev 就绪：http://localhost:3000（登录健康检查 /api/auth/ok）"
vite dev
