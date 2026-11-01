// Runtime bindings shared between the Cloudflare Worker entry point and the
// shared services.
//
// The Express application is platform-agnostic: the local Node server reads the
// handbook index from the filesystem, while the Worker reads it from the
// HANDBOOK_INDEX KV binding. KV and static-asset bindings only exist inside the
// Workers runtime, so the Worker entry passes them here before any request is
// dispatched. In Node (local server, tests) this state stays empty and the
// filesystem code paths are used instead.

const state = {
  kv: null,
  assets: null,
};

export function setWorkerRuntime({ kv = null, assets = null } = {}) {
  state.kv = kv;
  state.assets = assets;
}

export function getWorkerKv() {
  return state.kv;
}

export function getWorkerAssets() {
  return state.assets;
}

export function resetWorkerRuntime() {
  state.kv = null;
  state.assets = null;
}
