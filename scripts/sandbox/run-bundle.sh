#!/usr/bin/env bash
# 在无网络沙盒里运行本仓库的测试。
#
# 两个阶段：
#   1. 单元层: npm run typecheck / npm test / npm run build   (Tier 1-2)
#   2. E2E 层: 真实 Obsidian (AppImage) + 真实插件，通过 CDP 驱动 (Tier 4 最小回归)
#
# 用法（在离线包的仓库根目录执行）：
#   scripts/sandbox/run-bundle.sh [--appimage PATH] [--out DIR]
#                                 [--skip-unit] [--skip-e2e] [--boot-timeout SECONDS]
#
# 退出码：0 = 已执行的阶段全部通过
#         1 = 有阶段 FAIL
#         3 = 单元层通过、但 E2E 层 BLOCKED（缺 AppImage / Xvfb）
#
# 详见 docs/SANDBOX_OFFLINE.md。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

APPIMAGE=""
OUT="sandbox-out"
RUN_UNIT=1
RUN_E2E=1
BOOT_TIMEOUT=180

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appimage) APPIMAGE="${2:?--appimage 需要参数}"; shift 2 ;;
    --out) OUT="${2:?--out 需要参数}"; shift 2 ;;
    --skip-unit) RUN_UNIT=0; shift ;;
    --skip-e2e) RUN_E2E=0; shift ;;
    --boot-timeout) BOOT_TIMEOUT="${2:?--boot-timeout 需要参数}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

OUT_ABS="$PWD/$OUT"
mkdir -p "$OUT_ABS/logs" "$OUT_ABS/e2e"

SHA="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync("SANDBOX-MANIFEST.json", "utf8")).shortSha); } catch {}' 2>/dev/null)"
if [[ -z "$SHA" ]]; then
  SHA="$(git rev-parse --short HEAD 2>/dev/null || true)"
fi
if [[ -z "$SHA" ]]; then SHA="unknown"; fi
UNIT_STATUS="SKIPPED"
E2E_STATUS="SKIPPED"

run_step() { # run_step <name> <cmd...>
  local name="$1"; shift
  local log="$OUT_ABS/logs/$name.log"
  if "$@" >"$log" 2>&1; then
    echo "[PASS] $name"
    return 0
  fi
  echo "[FAIL] $name  (log: $log)"
  tail -25 "$log" || true
  return 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"
  fi
}

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_for_cdp() { # wait_for_cdp <port> <seconds>
  node -e '
    const [port, seconds] = process.argv.slice(1);
    const deadline = Date.now() + Number(seconds) * 1000;
    const url = `http://127.0.0.1:${port}/json/version`;
    (async () => {
      while (Date.now() < deadline) {
        try {
          const res = await fetch(url);
          if (res.ok) process.exit(0);
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
      process.exit(1);
    })();
  ' "$1" "$2"
}

# 确认 CDP 端点属于 Obsidian（防止在共享机器上连到别的进程）
verify_obsidian_cdp() { # verify_obsidian_cdp <port>
  node -e '
    const port = process.argv[1];
    const deadline = Date.now() + 40000;
    const url = `http://127.0.0.1:${port}/json/version`;
    (async () => {
      while (Date.now() < deadline) {
        try {
          const text = await (await fetch(url)).text();
          if (/obsidian/i.test(text)) process.exit(0);
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
      process.exit(1);
    })();
  ' "$1"
}

# ---------- 阶段 1：单元层 ----------
if [[ "$RUN_UNIT" == "1" ]]; then
  echo "== 单元层（typecheck / vitest / build）=="
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[FAIL] 缺少 node 或 npm"
    UNIT_STATUS="FAIL"
  elif [[ ! -d node_modules ]]; then
    echo "[FAIL] 缺少 node_modules：这个 bundle 不完整，请在联网环境重新构建"
    UNIT_STATUS="FAIL"
  else
    ok=1
    run_step typecheck npm run typecheck || ok=0
    run_step vitest npm test || ok=0
    run_step build npm run build || ok=0
    if [[ "$ok" == "1" ]]; then UNIT_STATUS="PASS"; else UNIT_STATUS="FAIL"; fi
  fi
fi

# ---------- 阶段 2：E2E 层 ----------
E2E_PORT=""
XVFB_PID=""
cleanup_e2e() {
  # 只匹配本次 session 自己的进程树（路径 + 端口双重限定），避免误杀共享机器上的其他实例
  local pattern="$OUT_ABS/app/squashfs-root.*remote-debugging-port=$E2E_PORT"
  if [[ -n "$E2E_PORT" ]]; then
    pkill -TERM -f "$pattern" 2>/dev/null || true
    sleep 1
    pkill -KILL -f "$pattern" 2>/dev/null || true
  fi
  if [[ -n "$XVFB_PID" ]]; then
    kill -KILL "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup_e2e EXIT

if [[ "$RUN_E2E" == "1" ]]; then
  echo "== E2E 层（真实 Obsidian + 真实插件 + CDP）=="

  if [[ -z "$APPIMAGE" ]]; then
    for cand in "$REPO_ROOT/Obsidian.AppImage" "$(dirname "$REPO_ROOT")/Obsidian.AppImage"; do
      if [[ -f "$cand" ]]; then APPIMAGE="$cand"; break; fi
    done
  fi
  if [[ -f "$APPIMAGE" ]]; then
    # 转成绝对路径：解包前会 cd 到工作目录，相对路径会失效
    APPIMAGE="$(cd "$(dirname "$APPIMAGE")" && pwd)/$(basename "$APPIMAGE")"
  fi

  if [[ ! -f "$APPIMAGE" ]]; then
    echo "[BLOCKED] 未找到 Obsidian AppImage（--appimage 未提供且包内不存在）"
    E2E_STATUS="BLOCKED"
  elif ! command -v Xvfb >/dev/null 2>&1 && [[ -z "${DISPLAY:-}" ]]; then
    echo "[BLOCKED] 系统没有 Xvfb，也没有可用的 DISPLAY"
    E2E_STATUS="BLOCKED"
  fi

  if [[ "$E2E_STATUS" != "BLOCKED" ]]; then
    APP_DIR="$OUT_ABS/app"
    RUNTIME="$OUT_ABS/runtime"
    VAULT="$RUNTIME/vault"
    mkdir -p "$APP_DIR" "$RUNTIME/home" "$VAULT"

    # 显示：优先自建 Xvfb；否则沿用已有 DISPLAY
    DISP=""
    if command -v Xvfb >/dev/null 2>&1; then
      for n in $(seq 170 220); do
        if [[ ! -e "/tmp/.X11-unix/X$n" && ! -e "/tmp/.X$n-lock" ]]; then DISP=$n; break; fi
      done
      if [[ -z "$DISP" ]]; then
        echo "[BLOCKED] 找不到空闲的显示号"
        E2E_STATUS="BLOCKED"
      else
        Xvfb ":$DISP" -screen 0 1920x1080x24 -nolisten tcp >"$OUT_ABS/logs/xvfb.log" 2>&1 &
        XVFB_PID=$!
        sleep 2
      fi
    else
      DISP="${DISPLAY#:}"
    fi
  fi

  # 解包 AppImage（--appimage-extract 不需要 FUSE）
  if [[ "$E2E_STATUS" != "BLOCKED" && ! -x "$APP_DIR/squashfs-root/AppRun" ]]; then
    chmod +x "$APPIMAGE" 2>/dev/null || true
    echo "解包 AppImage（首次需要几十秒）..."
    if ! (cd "$APP_DIR" && "$APPIMAGE" --appimage-extract >"$OUT_ABS/logs/appimage-extract.log" 2>&1); then
      echo "[BLOCKED] AppImage 解包失败（见 logs/appimage-extract.log）："
      tail -8 "$OUT_ABS/logs/appimage-extract.log" || true
      E2E_STATUS="BLOCKED"
    fi
  fi

  # 空闲 CDP 端口
  if [[ "$E2E_STATUS" != "BLOCKED" ]]; then
    for p in $(seq 9600 9800); do
      if port_free "$p"; then E2E_PORT="$p"; break; fi
    done
    if [[ -z "$E2E_PORT" ]]; then
      echo "[BLOCKED] 找不到空闲端口"
      E2E_STATUS="BLOCKED"
    fi
  fi

  # 准备测试 Vault + 启动 Obsidian + 跑 smoke
  if [[ "$E2E_STATUS" != "BLOCKED" ]]; then
    PLUGIN_DIR="$VAULT/.obsidian/plugins/obsidian-better-canvas"
    mkdir -p "$PLUGIN_DIR"
    cp main.js manifest.json styles.css "$PLUGIN_DIR/"
    echo '["obsidian-better-canvas"]' > "$VAULT/.obsidian/community-plugins.json"
    echo '{}' > "$VAULT/.obsidian/app.json"

    MAIN_SHA="$(sha256_of main.js)"
    node -e '
      const fs = require("fs");
      const [file, commit, mainSha] = process.argv.slice(1);
      fs.writeFileSync(file, JSON.stringify({ commit, mainJsSha256: mainSha, writtenAt: new Date().toISOString() }, null, 2) + "\n");
    ' "$VAULT/.bc-build-info.json" "$SHA" "$MAIN_SHA"

    VKEY="bc-sandbox-$(date +%s)"
    mkdir -p "$RUNTIME/home/.config/obsidian"
    printf '{"vaults":{"%s":{"path":"%s","ts":%s000,"open":true}}}\n' "$VKEY" "$VAULT" "$(date +%s)" \
      > "$RUNTIME/home/.config/obsidian/obsidian.json"

    export DISPLAY=":$DISP" HOME="$RUNTIME/home" XDG_CONFIG_HOME="$RUNTIME/home/.config" \
           XDG_CACHE_HOME="$RUNTIME/home/.cache" XDG_DATA_HOME="$RUNTIME/home/.local/share"
    echo "启动 Obsidian（display=:$DISP cdp=$E2E_PORT）..."
    setsid nohup "$APP_DIR/squashfs-root/AppRun" --no-sandbox --disable-gpu --disable-dev-shm-usage \
      --remote-debugging-port="$E2E_PORT" --remote-allow-origins="*" \
      "obsidian://open?vault=$VKEY" >"$OUT_ABS/logs/obsidian.log" 2>&1 &

    if wait_for_cdp "$E2E_PORT" "$BOOT_TIMEOUT" && verify_obsidian_cdp "$E2E_PORT"; then
      echo "Obsidian 已就绪，运行 e2e smoke ..."
      if node "$SCRIPT_DIR/e2e/smoke.js" --port "$E2E_PORT" --vault "$VAULT" --out "$OUT_ABS/e2e"; then
        E2E_STATUS="PASS"
      else
        E2E_STATUS="FAIL"
        echo "obsidian.log 末尾："
        tail -20 "$OUT_ABS/logs/obsidian.log" || true
      fi
    else
      E2E_STATUS="FAIL"
      echo "[FAIL] Obsidian 未在 ${BOOT_TIMEOUT}s 内启动（logs/obsidian.log）"
      tail -30 "$OUT_ABS/logs/obsidian.log" || true
    fi
  fi
fi

# ---------- 汇总 ----------
node -e '
  const fs = require("fs");
  const [file, commit, unit, e2e] = process.argv.slice(1);
  fs.writeFileSync(file, JSON.stringify({
    commit, unit, e2e, finishedAt: new Date().toISOString(),
  }, null, 2) + "\n");
' "$OUT_ABS/summary.json" "$SHA" "$UNIT_STATUS" "$E2E_STATUS"

echo
echo "== 结果 =="
echo "unit: $UNIT_STATUS    e2e: $E2E_STATUS"
echo "证据目录: $OUT_ABS （logs/、e2e/、summary.json）"
if (cd "$(dirname "$OUT_ABS")" && tar czf "$(basename "$OUT_ABS").tgz" "$(basename "$OUT_ABS")" >/dev/null 2>&1); then
  echo "已打包: $(dirname "$OUT_ABS")/$(basename "$OUT_ABS").tgz"
fi

if [[ "$UNIT_STATUS" == "FAIL" || "$E2E_STATUS" == "FAIL" ]]; then exit 1; fi
if [[ "$E2E_STATUS" == "BLOCKED" ]]; then exit 3; fi
exit 0
