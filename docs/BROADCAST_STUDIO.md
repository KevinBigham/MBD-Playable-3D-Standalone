# Broadcast Studio

`tools/broadcast-studio` is a development-only Theatre Core/Studio 0.7.2 app.
It stages an Anchor Yard fixture, exports native `BroadcastSequenceV1` JSON,
validates timelines, promotes only validated files, and round-trips without
drift. Theatre Studio and Core are absent from the production bundle. Run the
export/validate/promote commands from `package.json`.
