---
name: interview-me
description: "One question at a time, each carrying a best guess, until intent is clear enough to build, then a restatement to confirm. Use when an ask is underspecified, or before silently filling in requirements the operator never stated."
triggers:
  - "ask me questions first"
  - "interview me first"
  - "one question at a time"
  - "clarify the real requirement"
negative_triggers:
  - "prepare for customer interviews"
  - "design an interview guide"
  - "help me write a PRD"
license: MIT
metadata: {"clawdbot":{"emoji":"🎤","source":"addyosmani/agent-skills (MIT)"}}
---

# Interview Me

What people ask for and what they actually want are different things. Someone asks for
"a dashboard" because that is what one asks for, not because a dashboard solves their
problem. They say "make it faster" without a number to hit.

The cheapest moment to close that gap is before any plan, spec, or code exists. After
building starts, switching costs are real and the wrong thing gets rationalized into a
good-enough thing. This skill closes it by asking one question at a time, each with
your best guess attached, until you can predict the answer before it arrives.

## When to Use

- The ask is missing at least one of: **who** it is for, **why** now, what **success**
  looks like, what the binding **constraint** is
- The request is conventional rather than specific and you cannot unpack the
  convention without guessing
- You are about to start on assumptions you have not surfaced
- Two reasonable values are in tension (simplicity vs flexibility, cost vs speed) and
  the operator has not said which one wins
- The operator invokes it: "interview me", "grill me", "are we sure?"

**When NOT to use:** the ask is unambiguous and self-contained ("rename this
variable"); the operator asked for speed over verification; pure information requests;
mechanical operations; you already have ~95% confidence.

**Requires a live operator.** Do not run this inside an unattended mesh task or a
scheduled run. If the ask is underspecified there, report it as a blocker instead of
guessing.

## The Process

### Step 1: Hypothesize, with a confidence number

Before asking anything, write your current best read in one sentence, plus an honest
confidence number:

```
HYPOTHESIS: You want a way to answer "how are we doing?" in standup, and "dashboard"
was the convention that came to mind.
CONFIDENCE: ~30% — missing: who it is for, what "metrics" means here, what success is
```

The number forces honesty. If you wrote a high number but cannot predict reactions to
the next three questions you would ask, the number is wrong. Below ~70%, append the
reason on the same line — what is still unresolved. That tells the operator exactly
what the interview needs to surface.

### Step 2: One question at a time, each with a guess attached

```
Q: <one focused question>
GUESS: <your hypothesis for the answer, and the reasoning that produced it>
```

Wait for a reaction before asking the next one.

One at a time, not a batch: the operator cannot react to hypotheses buried in a list,
batches invite skim answers, and the third question usually depends on the answer to
the first. Attaching a guess is faster for them than generating from scratch, commits
you to something you can be visibly wrong about, and exposes your own assumptions —
which is the point.

The risk is a polite operator agreeing with your guess. Mitigate by being visibly
willing to be wrong, and occasionally guessing in a direction you expect pushback on.

### Step 3: Listen for "want vs should want"

The dangerous answers are the ones that sound like a thoughtful answer instead of a
true one. Watch for best-practice talk without specifics ("scalable", "clean
architecture"), deference to convention ("the standard approach"), and hedges like "I
should probably" or "I think I'm supposed to".

When you hear one, ask:

> "If you did not have to justify this to anyone, what would you actually want?"

That question often does more work than the previous five.

### Step 4: Restate intent in their words

When confidence is high, write back what you now think they want. Tight, their
language, structured so it can be corrected line by line:

```
Here's what I now think you want:

- Outcome:      <one line>
- User:         <one line — who benefits>
- Why now:      <one line — what changed>
- Success:      <one line — how we know it worked>
- Constraint:   <one line — the binding limit>
- Out of scope: <one line — what we are explicitly not doing>

Yes / no / refine?
```

The "Out of scope" line is non-negotiable. Half of misalignment is silent disagreement
about what is not being built.

### Step 5: Confirm — an explicit yes

These are not a yes:

- "Whatever you think is best." — delegation, meaning they are not at 95% either.
  Re-ask with two concrete options framed as a choice.
- "Sounds good." — ambiguous. Ask "anything you'd refine?"
- "Sure, let's go." — often a polite exit. Same follow-up.
- Silence, then "okay let's start." — they gave up on the interview rather than
  converged. Stop and ask what you missed.

If they correct you, fold it in and restate. Loop until you get an explicit yes.

### The 95% stop condition

You are done when you can answer yes to: *can I predict their reaction to the next
three questions I would ask?* If yes, stop interviewing and produce the restate. If
no, ask the next question.

It has a floor. If several rounds in you still cannot predict, that is information
about the ask, not a reason to grind: "I've asked five questions and still can't
predict your reactions. Something foundational is missing. Want to step back?"

## Output

The deliverable is a confirmed statement of intent: the Step 4 restate with an
explicit yes. Specs, plans, and task lists are downstream and consume it. If the
intent needs to persist across sessions, offer to record it in the active plan's
`DECISIONS.md`, and only after they confirm. Anything the intent implies about
writable paths belongs in that plan's `SCOPE.md`, alongside the rules in
`config/harness-rules.json`.

## Example

```
Operator: build me a dashboard for our metrics

HYPOTHESIS: You want a way to answer "how are we doing?" in standup, and "dashboard"
came to mind because that is the conventional answer.
CONFIDENCE: ~30% — missing: who it is for, what "metrics" are, what success is

Q:     When you say "how are we doing?", who is asking — you alone, the team in
       standup, or up the chain?
GUESS: the team in standup, because "we" usually scopes that way and standup is where
       the question gets asked. For execs the metrics and framing change a lot.

Operator: It's actually for me. I keep losing track of which experiments are running
and what their early signal looks like.

Updated read: not a team dashboard. A personal experiment tracker.
CONFIDENCE: ~60% — still missing: what "early signal" means, what done looks like

Q:     Is the gap that you do not know which experiments exist, or that you cannot see
       their results in one place?
GUESS: the second. You have a list somewhere, but results live in five tools and
       reconciling them by hand is what you are tired of.

Operator: First one actually. I don't have a list. They're spread across docs.
```

Two questions in, the ask is not "a dashboard", it is "a list". Different artifact,
different scope, different work.

## Red Flags

- Three or more questions in one message: that is batching, not interviewing
- A question with no hypothesis attached: that is surveying, not committing
- Accepting "whatever you think is best" as a terminal answer
- Producing a spec, plan, or task list before the restate is confirmed
- Questions framed as "what would be best practice?" instead of "what do you want?"
- Accepting a sophistication-signaling answer ("scalable", "modern") without probing
- Three rounds without confidence visibly rising: wrong questions, reframe
- A confidence number below ~70% with no reason attached
- Recording the intent before the operator has confirmed it
- Skipping the "Out of scope" line in the restate

## Verification

- [ ] An explicit hypothesis with a confidence number was stated in the first turn
- [ ] Every number below ~70% carried a one-line reason
- [ ] Questions were asked one at a time, each with a guess attached
- [ ] The "what would you actually want?" probe ran on any convention-signaling answer
- [ ] A concrete restate (Outcome / User / Why now / Success / Constraint / Out of
      scope) was written back
- [ ] The operator confirmed with an explicit yes
- [ ] At the stop point, reactions to the next three questions were predictable
- [ ] Any handoff downstream was framed as the confirmed intent, not the original ask
