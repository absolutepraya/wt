---
status: accepted
---

# Provide separate human and agent worktree listing formats

`wt ls` keeps a human-oriented table as its default output and adds an
explicit `--format agent` mode for coding agents. The human table detects the
available terminal width and truncates long cells with an ellipsis so its
box-drawing borders remain usable. The agent format uses numbered records and
labeled fields, preserves complete values, and emits absolute paths without
terminal styling.

## Decision

The supported formats are:

```text
wt ls                    # table, the default
wt ls --format table     # explicit table
wt ls --format agent     # numbered labeled records
```

Both formats include managed and unmanaged worktrees. The agent format keeps
managed and unmanaged records under separate headings, reports the current
worktree explicitly, and includes the same slot, branch, path, and port data
where those fields exist.

## Considered options

- Make agent output the default: rejected because the table is the established
  interactive interface for human users.
- Use JSON: rejected for this change because the requested agent interface is
  a readable numbered field list, while JSON would add a different contract
  and encourage agents to depend on implementation-shaped data.
- Truncate agent fields to terminal width: rejected because agents need the
  complete branch and absolute path values to select and operate on a
  worktree reliably.

## Consequences

The `--format` option is part of the public `ls` and `list` command contract.
The human renderer must remain width-safe as terminal sizes change. The
shipped WT skill directs agents to the agent format while leaving the default
table available for humans.
