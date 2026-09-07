# Source this file to enable `wt new --cd` and `wt cd` in Fish.
# It is intentionally profile-free; use `wt shell-init fish | source` for
# explicit current-session activation.

function wt
    switch $argv[1]
        case new cd
            set -l wt_output (command wt $argv | string collect -N)
            set -l wt_status $pipestatus[1]
            set -l wt_target ""
            set -l wt_consumed 0
            for wt_line in (string split \n -- $wt_output)
                if test $wt_status -eq 0; and test $wt_consumed -eq 0; and string match -q '__cd__:*' -- $wt_line
                    set -l wt_candidate (string sub -s 8 -- $wt_line)
                    if string match -q '/*' -- $wt_candidate; or string match -r -q '^[A-Za-z]:[/\\]' -- $wt_candidate; or string match -r -q '^\\\\' -- $wt_candidate
                        set wt_target $wt_candidate
                        set wt_consumed 1
                        continue
                    end
                end
                printf '%s\n' "$wt_line"
            end
            if test $wt_status -eq 0; and test -n "$wt_target"
                builtin cd -- "$wt_target"; or return $status
            end
            return $wt_status
        case '*'
            command wt $argv
    end
end
