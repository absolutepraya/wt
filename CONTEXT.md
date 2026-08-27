# wt

`wt` is a worktree-focused developer tool with multiple distribution channels. This glossary keeps the boundaries between its core command, project-local installation, and shell behavior explicit.

## Distribution language

**Core CLI**:
The authoritative command surface that creates, lists, enters, and removes managed worktrees.
_Avoid_: npm package, shell wrapper

**npm adapter**:
A project-local distribution boundary that exposes the `wt` command through Node package managers while delegating to the core CLI.
_Avoid_: Node rewrite, npm integration layer

**Consumer project**:
A user's repository that installs `wt` as a development dependency and owns the resulting package-manager lockfile.
_Avoid_: wt repository, parent repository

**Shell integration**:
The interactive-shell behavior that can change the caller's working directory after a `wt` command.
_Avoid_: npm install behavior, CLI output parsing

## Worktree language

**Main worktree**:
The primary checkout associated with the repository's default branch.
_Avoid_: root worktree, production worktree

**Feature worktree**:
A named, managed checkout used for isolated branch work alongside the main worktree.
_Avoid_: clone, temporary checkout

**Distribution artifact**:
A versioned installable form of `wt`, such as the standalone installer payload or the published npm package.
_Avoid_: source checkout, lockfile

## Status language

**Unmanaged worktree**:
An existing checkout that `wt` can discover but does not manage as a named slot.
_Avoid_: invalid worktree, external worktree

**Working-tree status**:
The state of files in one worktree relative to its current commit. It can be clean, staged, unstaged, untracked, or conflicted.
_Avoid_: diff, repository status

**Change summary**:
A compact account of the files represented by the working-tree status, separating staged, unstaged, untracked, and conflicted changes. It does not mean line-level additions and deletions.
_Avoid_: diff summary, dirty count

**Branch divergence**:
The difference between a worktree's branch and its comparison branch, expressed as commits ahead and behind.
_Avoid_: diff, sync status

**Port allocation**:
The port number assigned to a managed worktree for predictable local development. It describes an allocation, not whether a service is running.
_Avoid_: port health, server status

**Port health**:
Whether a service is listening on a worktree's allocated TCP port. It can be listening, unavailable, or unknown, and is distinct from the port allocation itself.
_Avoid_: port allocation, application health

**Worktree summary**:
The compact user-facing representation of a worktree, combining its identity with its working-tree status, branch divergence, and port information.
_Avoid_: worktree dashboard

**Identity line**:
The first line of a worktree summary containing the worktree's existing slot, name, branch, path, and port allocation information.
_Avoid_: header row, primary row

**Status line**:
The second line of a worktree summary containing the worktree's change summary and branch divergence, with explicit exceptional states when needed.
_Avoid_: detail row, diff row
