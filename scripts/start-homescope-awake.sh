#!/bin/zsh
set -euo pipefail

/usr/bin/open -gja Amphetamine
/bin/sleep 5

if /usr/bin/pmset -g assertions | /usr/bin/grep 'Amphetamine (Single-Use - System)' >/dev/null; then
  exit 0
fi

/usr/bin/osascript <<'APPLESCRIPT'
tell application "System Events"
  tell process "Amphetamine"
    click menu bar item 1 of menu bar 2
    delay 1
    if exists menu item "Indefinitely" of menu 1 of menu bar item 1 of menu bar 2 then
      click menu item "Indefinitely" of menu 1 of menu bar item 1 of menu bar 2
    else
      key code 53
    end if
  end tell
end tell
APPLESCRIPT
