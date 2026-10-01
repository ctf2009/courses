#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "$(uname -s)" = Linux
browser_path=$(node --input-type=module -e 'import { chromium } from "playwright-core"; console.log(chromium.executablePath())')
test -x "$browser_path"
# Ubuntu restricts user namespaces for downloaded browsers. Allow only this CI
# executable to create Chromium's sandbox; keep the system restriction enabled.
# https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
if test -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns &&
   test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1; then
  sudo tee /etc/apparmor.d/curator-ci-chromium >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>
profile curator-ci-chromium "$browser_path" flags=(unconfined) {
  userns,
}
EOF
  sudo apparmor_parser -r /etc/apparmor.d/curator-ci-chromium
fi
printf 'CURATOR_CHROMIUM_EXECUTABLE=%s\n' "$browser_path" >> "$GITHUB_ENV"
