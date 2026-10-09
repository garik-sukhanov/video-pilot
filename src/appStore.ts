import { create } from 'zustand';
import type { ProjectMeta } from './types';

export type AppView = 'projects' | 'editor';

/** Identity of the currently open project (the rest of the document lives in
 *  the editor store). Kept separate so the editor store stays focused on the
 *  timeline document. */
export interface OpenProject {
  id: string;
  name: string;
  createdAt: string;
}

interface AppShellState {
  view: AppView;
  current: OpenProject | null;
  /** Unsaved changes since the last successful write. */
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  /** Bumped whenever the projects list changes so the screen can refetch. */
  projectsRevision: number;

  setView: (view: AppView) => void;
  setCurrent: (project: OpenProject | null) => void;
  setName: (name: string) => void;
  markDirty: () => void;
  setSaving: (saving: boolean) => void;
  markSaved: (at: string) => void;
  bumpProjects: () => void;
}

export const useAppStore = create<AppShellState>((set) => ({
  view: 'projects',
  current: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  projectsRevision: 0,

  setView: (view) => set({ view }),
  setCurrent: (current) =>
    set({ current, dirty: false, lastSavedAt: current ? new Date().toISOString() : null }),
  setName: (name) => set((s) => (s.current ? { current: { ...s.current, name } } : {})),
  markDirty: () => set({ dirty: true }),
  setSaving: (saving) => set({ saving }),
  markSaved: (at) => set({ dirty: false, saving: false, lastSavedAt: at }),
  bumpProjects: () => set((s) => ({ projectsRevision: s.projectsRevision + 1 })),
}));

export function metaToOpen(meta: Pick<ProjectMeta, 'id' | 'name' | 'createdAt'>): OpenProject {
  return { id: meta.id, name: meta.name, createdAt: meta.createdAt };
}
