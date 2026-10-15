#!/usr/bin/env bash
# 构建“离线沙盒包”：把 HEAD 的完整 checkout + 已安装的 node_modules
# （可选再加 Obsidian AppImage）打成一个压缩包，供无网络环境运行测试。
#
# 用法（在联网机器、仓库根目录执行）：
#   scripts/sandbox/build-bundle.sh [--out FILE] [--appimage PATH]
#
# 详见 docs/SANDBOX_OFFLINE.md。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

OUT=""
APPIMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="${2:?--out 需要参数}"; shift 2 ;;
    --appimage) APPIMAGE="${2:?--appimage 需要参数}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"
  fi
}

SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
SUBJECT="$(git log -1 --pretty=%s)"

if [[ ! -d node_modules ]]; then
  echo "缺少 node_modules：请先在联网环境执行 npm install，再运行本脚本。" >&2
  exit 1
fi
if [[ ! -d node_modules/playwright-core ]]; then
  echo "缺少 node_modules/playwright-core：执行 npm install 后再试（package.json 已声明该 devDependency）。" >&2
  exit 1
fi
if [[ -n "$APPIMAGE" && ! -f "$APPIMAGE" ]]; then
  echo "AppImage 不存在: $APPIMAGE" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain | grep -v '^?? package-lock.json' || true)" ]]; then
  echo "警告：工作区有未提交改动，bundle 只包含 HEAD（$SHORT）的内容。" >&2
fi

NAME="better-canvas-sandbox"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/$NAME"
mkdir -p "$ROOT"

echo "[1/4] 导出 HEAD ($SHORT) ..."
git archive HEAD | tar -x -C "$ROOT"

echo "[2/4] 复制 node_modules ..."
cp -a node_modules "$ROOT/node_modules"
rm -rf "$ROOT/node_modules/.cache" "$ROOT/node_modules/.vite" "$ROOT/node_modules/.vitest" "$ROOT/node_modules/.tmp"

APP_SHA=""
APP_BYTES=""
if [[ -n "$APPIMAGE" ]]; then
  echo "[3/4] 附带 Obsidian AppImage ..."
  cp -a "$APPIMAGE" "$ROOT/Obsidian.AppImage"
  APP_SHA="$(sha256_of "$ROOT/Obsidian.AppImage")"
  APP_BYTES="$(stat -c %s "$ROOT/Obsidian.AppImage")"
else
  echo "[3/4] 未附带 AppImage（e2e 阶段会标记 BLOCKED；可用 --appimage 加入）"
fi

MAIN_JS_SHA="$(sha256_of "$ROOT/main.js")"
node -e '
  const fs = require("fs");
  const [file, commit, subject, short, mainSha, appSha, appBytes] = process.argv.slice(1);
  fs.writeFileSync(file, JSON.stringify({
    kind: "better-canvas-sandbox-bundle",
    commit,
    subject,
    shortSha: short,
    builtAt: new Date().toISOString(),
    builtOn: `${process.platform}-${process.arch}`,
    node: process.version,
    mainJsSha256: mainSha,
    appimage: appSha ? { file: "Obsidian.AppImage", sha256: appSha, bytes: Number(appBytes) } : null,
  }, null, 2) + "\n");
' "$ROOT/SANDBOX-MANIFEST.json" "$SHA" "$SUBJECT" "$SHORT" "$MAIN_JS_SHA" "$APP_SHA" "${APP_BYTES:-0}"

cat > "$ROOT/START-HERE.md" <<'MD'
# Better Canvas — 离线沙盒包

这个压缩包包含 `obsidian-better-canvas` 的 HEAD 完整 checkout 和
`node_modules`，无需联网即可运行测试。

在沙盒内执行：

    bash scripts/sandbox/run-bundle.sh --appimage ./Obsidian.AppImage

（如果包里没有 `Obsidian.AppImage`，请单独上传并用 `--appimage` 指定路径；
没有 AppImage 时单元层照常运行，e2e 层会如实报告为 BLOCKED。）

完整说明：`docs/SANDBOX_OFFLINE.md`
溯源信息：`SANDBOX-MANIFEST.json`
MD

OUT="${OUT:-dist/sandbox-bundle-$SHORT.tar.gz}"
mkdir -p "$(dirname "$OUT")"
echo "[4/4] 打包 $OUT ..."
tar czf "$OUT" -C "$STAGE" "$NAME"

SIZE="$(du -h "$OUT" | cut -f1)"
SUM="$(sha256_of "$OUT")"
cat <<EOF

完成。
  文件:   $OUT ($SIZE)
  sha256: $SUM
  commit: $SHA ($SHORT)

下一步：
  1. 把 bundle（如已附带 AppImage 则只需这一个文件）上传到无网沙盒；
  2. 在沙盒中按 docs/SANDBOX_OFFLINE.md 的步骤运行。
EOF
