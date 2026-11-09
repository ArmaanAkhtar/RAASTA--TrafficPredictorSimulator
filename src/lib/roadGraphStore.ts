// src/lib/roadGraphStore.ts
// Loads public/data/road_graph.bin once (falls back to the older road_graph.json); components read `version` so they re-route when it arrives.
import { create } from 'zustand';
import { parseRoadGraph, parseRoadGraphBinary, setDirectedGraph, type DirectedGraph } from './roadGraph';

interface RoadGraphState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  version: number;
  load: () => void;
}

export const useRoadGraph = create<RoadGraphState>((set, get) => ({
  status: 'idle',
  version: 0,
  load: () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    const loadJson = (): Promise<DirectedGraph | null> =>
      fetch('/data/road_graph.json')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data: unknown) => parseRoadGraph(data));
    fetch('/data/road_graph.bin')
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buf) => (buf ? parseRoadGraphBinary(buf) : null))
      .then((graph) => graph ?? loadJson())
      .then((graph) => {
        setDirectedGraph(graph);
        set((s) => ({ status: graph ? 'ready' : 'error', version: s.version + 1 }));
      })
      .catch(() => set({ status: 'error' }));
  },
}));
