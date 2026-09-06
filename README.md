# Soccer Tracking Dashboard

Real-time soccer tracking and match analytics. Detection, tracking and analytics run
**in the browser while the video plays** — there is no job to start and nothing to
upload. An optional Python worker adds a higher-accuracy YOLO26 pass.

## What it does

Drop in a clip, press play, and the dashboard streams:

- **Player detection and tracking** — persistent IDs, motion-model coasting through
  occlusions, crowd/spectator filtering so only players on the pitch are counted.
- **Automatic team assignment** — jersey colours are sampled from each player's torso
  and clustered in CIELAB, so the two kits are separated without any manual setup.
  Referees and keepers that match neither kit stay unassigned rather than being
  guessed into a team.
- **Possession and passes** — the player nearest the tracked ball holds possession;
  same-team control transfers are counted as passes, cross-team ones as turnovers.
- **Per-player metrics** — distance, average and peak speed, sprint bursts, time on
  pitch. Distances are metric: pitch scale is estimated from player height, so the
  numbers hold at any camera zoom.
- **Team shape** — formation bands, width, depth, compactness and attacking-third
  occupancy.
- **Explainable win probability** — a logistic model over possession, field tilt,
  passing, ball location and momentum. The dashboard shows each factor's signed
  contribution, so a number that looks wrong can be traced to the signal driving it.
- **Heatmaps, pass network, and an event timeline** you can click to seek.
- **GPT match briefing** — a coaching summary generated from the live stats, with a
  deterministic built-in analyst as fallback.

## Architecture

```
Browser (Next.js on Vercel)                     Optional worker (FastAPI)
  video → SSD-MobileNet (TF.js/WebGL)             video → YOLO26 + ByteTrack
        → tracker → team classifier                    → batch or streamed results
        → analytics → dashboard
```

The in-browser pipeline is the default and needs no backend, so the dashboard is
fully functional on Vercel. The worker is a separate, optional accuracy upgrade.

### Detection quality and measured cost

Three settings, switchable live in the control panel. Times are median inference
per frame, measured on 1280×442 broadcast footage on an Apple laptop GPU (WebGL):

| Mode | Model | Tiles | Measured | Use for |
| --- | --- | --- | --- | --- |
| Fast | lite MobileNet v2 SSD | 1 | ~97 ms (10 fps) | Close-up footage, slower machines |
| Balanced *(default)* | lite MobileNet v2 SSD | 2 | ~182 ms (5.5 fps) | Most broadcast angles |
| Accurate | MobileNet v2 SSD | 2 | ~295 ms (3.4 fps) | Distant players, best recall |

SSD resizes its input to 300×300, so a wide broadcast frame turns each player into a
handful of pixels. Tiling runs the model over overlapping crops and merges the
results with NMS, which is what makes far-side players detectable at all. Cost per
tile is roughly constant for the same reason.

Detection running at 3–10 fps does not mean the overlay does. Boxes are repainted
every animation frame and advanced along each track's motion vector, so they follow
the players smoothly between detections. If a device cannot sustain a usable rate,
the engine steps down a tier automatically until the user picks one explicitly.

The analytics layer itself is not the constraint: a full re-derivation over 22
players carrying 160 samples each costs about **2 ms**, against the 260 ms live
update budget (`npm run test:perf`).

### Distances, and what they are worth

Every metric in metres — player distance, speed, team width and depth, pass
length, separation, area covered — goes through a perspective model rather than
one pixels-per-metre number.

A single scalar is only correct at one depth. On a broadcast angle the ground
recedes, so a player at the top of frame is half the height of one on the near
touchline and a vertical pixel up there spans several times more turf. Applying
one scale everywhere measured a team spread across the pitch as five metres
wide. Players are a known height, so their apparent height at each image row is
a ruler for that row: fitting height against row recovers scale as a function of
depth, and integrating along the vertical span converts distances honestly.

These remain estimates. Without detecting pitch markings there is no true
homography, so treat them as well-founded approximations — good for comparing
players and passages within a clip, not for adjudicating a transfer fee. The
model reports whether it managed to calibrate; when too few players are visible
at differing depths it falls back to the flat scale.

### Which way each team is playing

Teams are labelled A and B by jersey colour, which says nothing about direction
of play. Attacking-third share and formation bands are read relative to the end
each side is actually defending, inferred from which team is sitting deeper.
Assuming a fixed direction made both wrong whenever the colour clustering landed
the other way round, and the tests mirror the pitch to check the reading does
not change.

### How possession is measured

One sequence covers the whole clip. Every sampled frame gets an owner: the player
nearest the action, where the action is the tracked ball when it is visible, and a
blend of the crowd centre and frame centre when it is not (broadcast cameras keep
play near the middle of shot).

Two rules keep it honest. Ownership only transfers after a challenger is nearest for
two consecutive samples, so a contested ball does not flicker between players — but
that hysteresis is overridden the moment the current holder is out of range, so a
pass is never suppressed. The dashboard reports what fraction of samples were
actually anchored on a tracked ball, rather than presenting an estimate as a
measurement.

## Quick start

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000, drop in a clip, press play. Nothing else is required —
analysis starts on playback, there is no job to kick off.

You can also deep-link a clip: `/workspace?video=<url>`. The URL must be same-origin
or send CORS headers — a cross-origin video without them taints the canvas and blocks
the pixel reads that team classification depends on.

### Optional: YOLO26 worker

```bash
cd worker
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python server.py
```

Then set `NEXT_PUBLIC_WORKER_HTTP_BASE` / `NEXT_PUBLIC_WORKER_WS_BASE` and use the
"High-accuracy worker" section of the control panel. Leave these unset to run
browser-only.

### GPT insights

Set `OPENAI_API_KEY` in `apps/web/.env.local`. `OPENAI_MODEL` defaults to
`gpt-5-mini`; `OPENAI_BASE_URL` can point at an OpenAI-compatible gateway or Azure
deployment.

Model choice is a latency decision, measured on this task:

| Model | Time to briefing |
| --- | --- |
| gpt-4.1 | ~1.9 s |
| gpt-5-nano | ~4.1 s |
| **gpt-5-mini** *(default)* | ~7.1 s |
| gpt-5 | ~17 s at low reasoning effort, ~60 s at default |

Full `gpt-5` is not in the fallback chain because a panel that refreshes while a clip
plays cannot wait a minute. Set `OPENAI_MODEL=gpt-5` to use it anyway.

Reasoning models spend their completion budget on hidden reasoning tokens before
writing any prose, so they are sent `max_completion_tokens: 2000` and
`reasoning_effort: low`. At the previous budget of 500 the entire allowance went to
reasoning and the reply came back empty with `finish_reason: "length"` — the model
appeared to fail silently and the chain fell through to the next one.

Summary fields are named unambiguously (`totalTrackedControlSeconds`,
`modelWinProbabilityPctA`) because terser names were being read back as different
metrics — win probability reported as duels won, total control time as an average
spell length.

The briefing waits until there is enough tracked play to describe, then refreshes at
most every 30 seconds. If the key is missing, rejected, out of credits, or slow to
respond, the card falls back to a built-in briefing generated from the same numbers,
with the reason shown inline — it never goes blank.

## Deploying

Set the Vercel root directory to `apps/web`. No other configuration is needed for the
live analysis path. Add `OPENAI_API_KEY` for GPT briefings and the
`NEXT_PUBLIC_WORKER_*` variables only if you are hosting the worker.

## Development

```bash
npm run dev        # dev server
npm run test       # 38 checks: analytics, ownership, win model, tracker, ball finder, teams
npm run test:perf  # analytics cost per live update, against the 260 ms budget
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

For a demo, run the production build (`npm run build && npm start`) rather than the
dev server — cold dev compilation of the workspace route is slow, especially on a
nearly full disk.

## Licence

AGPL-3.0 when the YOLO26 / Ultralytics worker is used. The browser pipeline uses
TensorFlow.js and the COCO-SSD model (Apache-2.0).
