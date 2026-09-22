// Extension point only: no audio assets, playback, or audio permission in v0.1.
// A later adapter may implement submit(), vote({id, yes}), verdict({passed}), error().
let adapter = null;
export function connectSoundAdapter(next) { adapter = next; }
export function soundEvent(name, data) { try { adapter?.[name]?.(data); } catch { /* Sound never blocks a decision. */ } }
