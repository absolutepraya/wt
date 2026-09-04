import type { ShellName } from "./types.js";

const BASH_OR_ZSH = `wt() {
  case "\${1-}" in
    new|cd)
      local wt_output wt_status wt_line wt_target wt_consumed wt_candidate
      wt_output=$(command wt "$@")
      wt_status=$?
      wt_target=""
      wt_consumed=0
      while IFS= read -r wt_line || [ -n "$wt_line" ]; do
        if [ "$wt_status" -eq 0 ] && [ "$wt_consumed" -eq 0 ] && [ "\${wt_line#__cd__:}" != "$wt_line" ]; then
          wt_candidate="\${wt_line#__cd__:}"
          case "$wt_candidate" in
            /*) wt_target="$wt_candidate"; wt_consumed=1; continue ;;
          esac
        fi
        printf '%s\\n' "$wt_line"
      done <<EOF
\$wt_output
EOF
      if [ "$wt_status" -eq 0 ] && [ -n "$wt_target" ]; then
        builtin cd -- "$wt_target" || return $?
      fi
      return "$wt_status"
      ;;
    *) command wt "$@" ;;
  esac
}`;

const FISH = `function wt
    switch $argv[1]
        case new cd
            set -l wt_output (command wt $argv | string collect -N)
            set -l wt_status $pipestatus[1]
            set -l wt_target ""
            set -l wt_consumed 0
            for wt_line in (string split \\n -- $wt_output)
                if test $wt_status -eq 0; and test $wt_consumed -eq 0; and string match -q '__cd__:*' -- $wt_line
                    set -l wt_candidate (string sub -s 8 -- $wt_line)
                    if string match -q '/*' -- $wt_candidate
                        set wt_target $wt_candidate
                        set wt_consumed 1
                        continue
                    end
                end
                printf '%s\\n' "$wt_line"
            end
            if test $wt_status -eq 0; and test -n "$wt_target"
                builtin cd -- "$wt_target"; or return $status
            end
            return $wt_status
        case '*'
            command wt $argv
    end
end`;

const POWERSHELL = `function wt {
    [CmdletBinding()]
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $wtExecutable = (Get-Command wt -CommandType Application | Select-Object -First 1).Path
    if (-not $wtExecutable) {
        Write-Error "wt executable was not found."
        return
    }

    if ($Arguments.Count -gt 0 -and $Arguments[0] -in @('new', 'cd')) {
        $wtOutput = @(& $wtExecutable @Arguments)
        $wtStatus = $LASTEXITCODE
        $wtTarget = $null
        $wtConsumed = $false
        foreach ($wtLine in $wtOutput) {
            $wtText = [string]$wtLine
            if ($wtStatus -eq 0 -and -not $wtConsumed -and $wtText -match '^__cd__:(.+)$') {
                $wtCandidate = $Matches[1]
                if ([IO.Path]::IsPathRooted($wtCandidate)) {
                    $wtTarget = $wtCandidate
                    $wtConsumed = $true
                    continue
                }
            }
            Write-Output $wtText
        }
        if ($wtStatus -eq 0 -and $null -ne $wtTarget) {
            Set-Location -LiteralPath $wtTarget
        }
        $global:LASTEXITCODE = $wtStatus
        return
    }

    & $wtExecutable @Arguments
}`;

/** Return current-session shell integration. It never edits shell profiles. */
export function renderShellInit(shell: ShellName): string {
  switch (shell) {
    case "bash":
    case "zsh":
      return BASH_OR_ZSH;
    case "fish":
      return FISH;
    case "powershell":
      return POWERSHELL;
  }
}
