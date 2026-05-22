# wt shell wrapper for fish.
# See shell/wt.sh for the rationale (bash/zsh version).
#
# Install: source this file from ~/.config/fish/config.fish, or symlink
# it into ~/.config/fish/conf.d/wt.fish so fish auto-loads it.

function wt
    switch $argv[1]
        case new cd
            set -l out (command wt $argv)
            set -l rc $status
            if test $rc -ne 0
                return $rc
            end
            set -l target ""
            for line in $out
                if string match -q '__cd__:*' -- $line
                    set target (string sub -s 8 -- $line)
                else
                    echo $line
                end
            end
            if test -n "$target"
                cd $target
            end
        case '*'
            command wt $argv
    end
end
