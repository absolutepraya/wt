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
