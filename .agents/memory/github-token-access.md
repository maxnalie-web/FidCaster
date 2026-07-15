---
name: GitHub token access
description: How to read the private native repo from within the Replit environment.
---

## Rule
The env var `GITHUB_TOKEN` (a ghp_ personal access token) is set in the Replit secrets and works to read `maxnalie-web/fidcaster-native` (private repo).

## How to apply
- Raw file: `curl -sf -H "Authorization: token $GITHUB_TOKEN" "https://raw.githubusercontent.com/maxnalie-web/fidcaster-native/main/src/..."`
- File tree: `curl -sf -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/maxnalie-web/fidcaster-native/git/trees/HEAD?recursive=1"`
- Returns empty output (not 404) when the token lacks access or the path is wrong — always verify with the tree endpoint first.

## Why
Repo is private; unauthenticated raw.githubusercontent.com requests silently return empty.
