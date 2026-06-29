---
name: Playwright .or() strict mode violation
description: .or() unions all matching locators; toBeVisible() throws if multiple elements match
---

# Playwright `.or()` Strict Mode

## The Rule
When using `locatorA.or(locatorB)` in Playwright, if **both** locators match elements on the page,
Playwright treats it as a multi-element locator and throws a strict mode violation on `.toBeVisible()`.

## Why
`.or()` was designed for "element A OR element B might appear" (XOR case).
When both are simultaneously present (e.g. all three stat cards "Today", "This week", "Total"),
Playwright resolves 3 elements and can't pick one for the assertion.

## How to Apply
- Add `.first()` to the outer `.or()` chain when multiple alternatives may all be visible:
  ```typescript
  // BAD — throws if both/all match
  page.getByText("Today").or(page.getByText("This week")).toBeVisible()
  
  // GOOD
  page.getByText("Today").or(page.getByText("This week")).first().toBeVisible()
  ```
- Use `{ exact: true }` to prevent substring matching from inflating the match count:
  ```typescript
  // "Snippets" substring-matches "e2e-snippets-..." and "No snippets yet"
  page.getByText("Snippets", { exact: true })  // only matches exactly "Snippets"
  ```
- For case-insensitive substring problems (e.g. `getByText("OK")` matching `"ok"` in JSON body),
  use `getByText("200 OK", { exact: true })` to pin the full string.
- When the `.or()` intent is "any one of several alternatives visible at once", just pick
  the first and use `.first()`.
