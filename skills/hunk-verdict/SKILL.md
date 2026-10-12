---
name: hunk-verdict
description: Use when the user should review code changes in Hunk and approve or deny them, or when an approve, comment or deny decision arrives from a Hunk review.
---

# Hunk Verdict

The user reviews changes in [Hunk](https://hunk.dev/), leaves comments, and presses a key to approve, deny, or send the comments back without deciding yet. The `hunk-verdict` Hunk extension hands each decision to `hunk verdict listen`. Run `hunk verdict listen --help` for its options.

## Open the Review

Open Hunk where the user can see it, in a terminal tab or pane of its own, in the repository holding the changes:

```bash
hunk diff --watch
```

Use `hunk diff --staged --watch` to review only staged changes. `--watch` keeps the review current as you change files, so one Hunk session lasts across every round of review. Don't open a second one while it's running.

## Listen for Decisions

Run the listener under a tool that turns each line a background command prints into a notification, such as Claude Code's Monitor tool, with the longest timeout it allows:

```bash
hunk verdict listen --repo <directory>
```

Each decision arrives as its own line, `review-approved`, `review-commented` or `review-denied`, whenever the user makes it. `review-closed` means the user closed the review. Re-arm the listener whenever it expires while the review is still open.

If the listener says several reviews are open, pass `--session` with the ID of the one you opened: the newest in `hunk session list --json` for that repository.

## Act on a Decision

Read the review's comments after every decision:

```bash
hunk session comment list --repo <directory> --type all --json
```

Act on the user's comments that don't have a reply from you yet. The rest were handled in an earlier round.

- **Deny:** Address the comments, then wait for the next decision. Don't treat the work as accepted until an approval arrives.
- **Comment:** The user has questions or notes and hasn't approved or denied yet. Answer the questions in your replies, make any changes the comments ask for, then wait for the next decision.
- **Approve:** The changes are accepted. Make any small fixes the comments ask for without another review.

Reply to every comment you handle, so the next round can tell it's done: confirm the change, push back instead of making it, or add context alongside it.

```bash
hunk session comment add --repo <directory> --reply-to <comment-id> --summary "<reply>"
```

## Rationalizations

| Thought                                            | Reality                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| "Approved, so there's nothing to read"             | Approvals can carry comments. Read them every time.                 |
| "They commented, so they're happy with the rest"   | Comment doesn't accept the work. Wait for an approval or a denial.  |
| "I'll ask the user whether they're done reviewing" | The decision arrives on its own. Wait for it.                       |
| "I'll reopen Hunk for the next round"              | `--watch` already shows the new changes. Keep the one session open. |
