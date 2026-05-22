# wt shell wrapper — sourced by bash/zsh to give `wt new` and `wt cd`
# the ability to actually change your shell's working directory.
#
# The wt binary cannot cd for you (a child process can't change its
# parent's cwd), so on `new` and `cd` it prints a `__cd__:<path>`
# sentinel line; this wrapper reads it and runs `cd` in your shell.
#
# Install: source this file from ~/.bashrc or ~/.zshrc. The bundled
# install.sh does this for you between marker comments.

wt() {
  case "$1" in
    new|cd)
      local out
      out=$(command wt "$@") || return $?
      local target
      target=$(printf '%s' "$out" | awk '/^__cd__:/{print substr($0, 8); exit}')
      printf '%s\n' "$out" | grep -v '^__cd__:' || true
      [ -n "$target" ] && cd "$target"
      ;;
    *) command wt "$@" ;;
  esac
}
