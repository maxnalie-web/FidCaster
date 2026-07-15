---
name: bezoar repo identity
description: maxnalie-web/bezoar is a Persian pharmacy/inventory app, not a Farcaster native client
---

## The Rule
Do not look to the bezoar repo for Farcaster-specific UI patterns or notification code.

## Why
The repo contains a React Native + Expo pharmacy management app with screens for drugs, patients, inventory, sales, and custom reminders. Its NotificationsScreen is for medical appointment/installment reminders, not social notifications.

## How to Apply
When the user says "check the native repo for notification design", the usable takeaway is the *visual design pattern* (GlassCard + iconCircle + FadeInRight) which can be adapted for Farcaster notifications in web — not the actual notification logic.
