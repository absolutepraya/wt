# Source this file to enable `wt new --cd` and `wt cd` in Bash or Zsh.
# It is intentionally profile-free; use `eval "$(wt shell-init bash)"` for
# explicit current-session activation.

wt() {
  case "${1-}" in
    new|cd)
      local wt_output wt_status wt_line wt_target wt_consumed wt_candidate
      wt_output=$(command wt "$@")
      wt_status=$?
      wt_target=""
      wt_consumed=0
      while IFS= read -r wt_line || [ -n "$wt_line" ]; do
        if [ "$wt_status" -eq 0 ] && [ "$wt_consumed" -eq 0 ] && [ "${wt_line#__cd__:}" != "$wt_line" ]; then
          wt_candidate="${wt_line#__cd__:}"
          case "$wt_candidate" in
            /*|[A-Za-z]:/*|[A-Za-z]:\\*|\\\\*) wt_target="$wt_candidate"; wt_consumed=1; continue ;;
          esac
        fi
        printf '%s\n' "$wt_line"
      done <<EOF
$wt_output
EOF
      if [ "$wt_status" -eq 0 ] && [ -n "$wt_target" ]; then
        builtin cd -- "$wt_target" || return $?
      fi
      return "$wt_status"
      ;;
    *) command wt "$@" ;;
  esac
}
