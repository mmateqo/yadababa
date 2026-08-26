/* ============================================================================
   SELORA — the clock.

   One number, in seconds, read by everything. Not React state: this is sampled
   dozens of times a frame from a render loop and from DOM writers, and a state
   update per frame would be a tree reconciliation per frame.

   It pauses when the tab is hidden and resumes without a jump — a film that
   accumulates fourteen seconds of elapsed time while nobody is watching and
   then delivers them in one frame is not a film, it is a cut.
   ========================================================================== */

import { DURATION } from "./cinematic";

interface ClockState {
  /** seconds since the film began, clamped to its duration */
  time: number;
  /** true once the film has reached its end and stopped */
  done: boolean;
  running: boolean;
}

export const clock: ClockState = { time: 0, done: false, running: false };

type Tick = (t: number, dt: number) => void;
const subscribers = new Set<Tick>();

/** Subscribe to the frame. Called after `clock.time` has been advanced. */
export function onFrame(fn: Tick): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

let raf = 0;
let last = 0;

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  /* The clamp is a guard against a genuine main-thread stall — a long garbage
     collection, a shader link — not against slow frames. At 0.05 it was both,
     and that is a bug you cannot see on a fast machine: any device rendering
     below twenty frames a second had every frame's elapsed time truncated, so
     the film played in slow motion and a fourteen-second shot took thirty. The
     hidden-tab case is handled by resetting `last` in bindVisibility, not here,
     so this only ever has to absorb a stall. */
  const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 0.25);
  last = now;

  if (!clock.done) {
    clock.time = Math.min(clock.time + dt, DURATION);
    if (clock.time >= DURATION) clock.done = true;
  }

  for (const fn of subscribers) fn(clock.time, dt);
}

export function startClock() {
  if (clock.running) return;
  clock.running = true;
  last = 0;
  raf = requestAnimationFrame(frame);
}

export function stopClock() {
  clock.running = false;
  cancelAnimationFrame(raf);
  raf = 0;
}

/** Jump to the end. Used by reduced motion, and by the QA tools. */
export function finish() {
  clock.time = DURATION;
  clock.done = true;
}

/** Park the film at a position without advancing it — QA only. */
export function seek(t: number) {
  clock.time = Math.max(0, Math.min(t, DURATION));
  clock.done = clock.time >= DURATION;
}

/**
 * Run one frame's subscribers at the current time without advancing.
 *
 * The DOM-side writers (sky, nav ink, the hero's reveal) are all driven by
 * `onFrame`, so a parked film needs one broadcast for them to catch up — the
 * canvas keeps drawing on its own loop, but the page around it would otherwise
 * still be showing the moment the clock was stopped at.
 */
export function tick() {
  for (const fn of subscribers) fn(clock.time, 0);
}

export function bindVisibility() {
  const onChange = () => {
    /* Resetting `last` is the whole fix: without it the first frame back
       carries the entire hidden interval and the film leaps. */
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (clock.running && raf === 0) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
