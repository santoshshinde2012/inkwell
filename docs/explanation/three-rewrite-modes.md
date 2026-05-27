# Three rewrite modes

_Why one popover button does three different things._

The popover offers four actions: **Reply**, **Translate**, **Grammar**,
and **Rewrite**. Rewrite is intentionally overloaded — it picks one of
three sub-modes based on what the user provided:

| Sub-mode | When picked | What the model is told |
| --- | --- | --- |
| **Transform** | draft + instruction | "Rewrite the user's draft per the instruction. Preserve underlying meaning." |
| **Light edit** | draft only, no instruction | "Lightly edit for clarity and concision. Preserve voice." |
| **Compose** | no draft, but instruction and/or page context | "Write the actual text the user described — match the apparent target medium." |

The picker lives in [`_RewriteStrategy._pick_mode`](../../backend/src/inkwell_backend/services/prompt.py).

## Why we collapsed compose into rewrite

The natural alternative is a fifth action — **Compose** — alongside
Reply / Translate / Grammar / Rewrite. We explicitly chose not to do this.

Reasoning:

1. **Cognitive load.** The popover already carries four actions. A fifth
   would push the segmented control past the point where users scan it
   comfortably at a glance.
2. **Mental model match.** Users say "rewrite this, but make it about
   asking for next Thursday" — they don't think of compose-from-scratch
   as a separate task. They think of it as *rewrite a blank slate*.
3. **Smooth degradation.** When a user has typed a draft and provides
   an instruction, the model gets both — that's transform. When the
   field is empty, the same code path generates from the brief — that's
   compose. The user doesn't choose; the popover figures it out.

The cost is a slightly heavier prompt — three system instructions
instead of one — and slightly trickier UX wording. We pay both and
move on.

## What Reply does instead

Reply is its own action because the *intent* is different:

- Reply assumes you're answering an email/post; it inserts at cursor
  (preserves any draft you started).
- Rewrite (any sub-mode) replaces the field's content.

If we let Rewrite-compose handle "draft a reply too," users would have
no consistent rule for which button preserves their typing. So Reply
stays separate, with its own simpler prompt and its own UX rule.

## Why Grammar isn't overloaded

Grammar requires an existing draft. Without text to fix, the action is
meaningless — there's no "compose" sub-mode. Validation enforces this
([schemas.ts](../../frontend/packages/shared/src/schemas.ts)).

## Concrete examples

| User has typed | User picks | User instruction | Mode | Output |
| --- | --- | --- | --- | --- |
| "hey can we move the meeting" | Rewrite | "make it formal" | Transform | "Hi — would you be open to rescheduling our meeting?" |
| "hey can we move the meeting" | Rewrite | (none) | Light edit | "Could we move the meeting?" |
| (empty) | Rewrite | "ask Bob to reschedule for Thursday 2pm" | Compose | "Hi Bob — could we move our meeting to Thursday at 2pm?" |
| (empty) | Rewrite, on a Gmail thread | (none) | Compose | A reasonable reply to the thread, with no extra steering |

## See also

- [Reference: API § /api/v1/complete](../reference/api.md#post-apiv1complete)
  — the validation rules.
- [Prompt-injection defense](./prompt-injection-defense.md) — why each
  sub-mode has its own restated data-vs-commands rule.
- [`prompt.py`](../../backend/src/inkwell_backend/services/prompt.py) — the
  source of truth.
