---
name: Bezoar GitHub Actions 0-steps bug
description: Why bezoar's build-apk.yml caused all runs to fail with 0 steps completed
---

# Rule
Never put zero-indented code inside a YAML block scalar (`run: |`).

**Why:** In YAML, a block scalar's indentation level is set by its first non-empty line. Any subsequent line with *less* indentation terminates the block. Inline Python in a `run: |` block like `python3 -c "\nimport sys\n..."` where `import sys` starts at column 0 terminates the YAML block, making the whole workflow file invalid. GitHub Actions then fails the job before any steps run (status=completed, conclusion=failure, steps=0).

**How to apply:** Replace inline Python in `run:` blocks with single-line Node.js (`node -e "..."`) or write a script to a file first, then run it. All content lines inside a YAML block scalar must be indented at least as much as the first content line.
