# Replay System

Live rendering writes actual presentation transforms into a fixed 30 Hz, 12
second ring buffer. Automatic selection observes normal `GameEvent` delivery and
starts only after a dead-ball-safe phase; playback applies recorded transforms
and never re-runs simulation. Positions/scales interpolate linearly and packed
quaternions slerp. Replay cues are semantic and presentation-only. Skip, tab
hide, resize, orientation change, Free Camera exit, and context loss restore
live camera/HUD/audio state. See `reports/replay/REPLAY_MEMORY_AND_CAPACITY.md`.
