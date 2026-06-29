#!/bin/bash
set -e
pnpm install --prefer-offline --ignore-scripts 2>/dev/null || pnpm install --ignore-scripts
