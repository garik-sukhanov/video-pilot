import { useEffect, useRef, useState } from 'react';
import type { ProjectMeta } from '../types';
import { useAppStore } from '../appStore';
import { openProject, createAndOpenProject } from '../projectIO';
import { formatTime } from '../store';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `сегодня, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `вчера, ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ProjectsScreen() {
  const revision = useAppStore((s) => s.projectsRevision);
  const bump = useAppStore((s) => s.bumpProjects);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.vp.projects
      .list()
      .then((list) => {
        if (alive) setProjects(list);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [revision]);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  async function handleCreate() {
    const name = newName.trim() || 'Без названия';
    setBusy(true);
    try {
      await createAndOpenProject(name);
    } finally {
      setBusy(false);
      setCreating(false);
      setNewName('');
    }
  }

  async function handleOpen(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await openProject(id);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    const name = renameValue.trim();
    setRenameId(null);
    if (!name) return;
    await window.vp.projects.rename(id, name);
    bump();
  }

  async function handleDuplicate(id: string) {
    await window.vp.projects.duplicate(id);
    bump();
  }

  async function handleDelete(meta: ProjectMeta) {
    setConfirmDelete(null);
    await window.vp.projects.remove(meta.id);
    bump();
  }

  return (
    <div className="h-screen w-screen bg-panel text-white flex flex-col">
      {/* draggable top strip with macOS traffic-light inset */}
      <div className="titlebar-drag h-12 shrink-0" />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 pb-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold">Проекты</h1>
              <p className="text-sm text-gray-500 mt-1">
                {loading
                  ? 'Загрузка…'
                  : projects.length === 0
                    ? 'Пока нет ни одного проекта'
                    : `${projects.length} ${plural(projects.length, 'проект', 'проекта', 'проектов')}`}
              </p>
            </div>
            <button
              onClick={() => setCreating(true)}
              disabled={busy}
              className="no-drag px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              + Новый проект
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {creating && (
              <div className="rounded-xl border border-accent/60 bg-panel-2 overflow-hidden">
                <div className="aspect-video bg-gradient-to-br from-accent/30 to-accent-2/20 flex items-center justify-center text-3xl text-white/40">
                  ▶
                </div>
                <div className="p-3">
                  <input
                    ref={createInputRef}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreate();
                      if (e.key === 'Escape') {
                        setCreating(false);
                        setNewName('');
                      }
                    }}
                    placeholder="Название проекта"
                    className="w-full bg-panel-3 border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleCreate}
                      disabled={busy}
                      className="flex-1 px-2 py-1 rounded bg-accent hover:bg-accent/80 disabled:opacity-50 text-xs"
                    >
                      Создать
                    </button>
                    <button
                      onClick={() => {
                        setCreating(false);
                        setNewName('');
                      }}
                      className="px-2 py-1 rounded bg-panel-3 hover:bg-panel-3/60 border border-border text-xs"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              </div>
            )}

            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                renaming={renameId === p.id}
                renameValue={renameValue}
                onOpen={() => handleOpen(p.id)}
                onStartRename={() => {
                  setRenameId(p.id);
                  setRenameValue(p.name);
                }}
                onRenameChange={setRenameValue}
                onCommitRename={() => handleRename(p.id)}
                onCancelRename={() => setRenameId(null)}
                onDuplicate={() => handleDuplicate(p.id)}
                onDelete={() => setConfirmDelete(p)}
              />
            ))}
          </div>

          {!loading && projects.length === 0 && !creating && (
            <div className="text-center text-gray-500 mt-24">
              <div className="text-5xl mb-4 opacity-30">🎬</div>
              <p className="mb-4">Создайте первый проект, чтобы начать монтаж.</p>
              <button
                onClick={() => setCreating(true)}
                className="px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 text-sm font-medium"
              >
                + Новый проект
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-panel-2 border border-border rounded-lg p-5 w-[380px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-medium mb-2">Удалить проект?</h2>
            <p className="text-sm text-gray-400 mb-4">
              «{confirmDelete.name}» будет удалён безвозвратно. Исходные медиафайлы на диске
              затронуты не будут.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded text-xs bg-panel-3 hover:bg-panel-3/60 border border-border"
              >
                Отмена
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="px-3 py-1.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  project: ProjectMeta;
  renaming: boolean;
  renameValue: string;
  onOpen: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  renaming,
  renameValue,
  onOpen,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onDuplicate,
  onDelete,
}: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group relative rounded-xl border border-border bg-panel-2 overflow-hidden hover:border-accent/50 transition-colors">
      <button
        onClick={onOpen}
        className="block w-full aspect-video bg-black relative"
        title="Открыть проект"
      >
        {project.poster ? (
          <img src={project.poster} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-accent/25 to-accent-2/15 flex items-center justify-center text-3xl text-white/40">
            ▶
          </div>
        )}
        {project.durationSec > 0 && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-white/90">
            {formatTime(project.durationSec)}
          </span>
        )}
      </button>

      <div className="p-3">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            className="w-full bg-panel-3 border border-accent rounded px-2 py-1 text-sm outline-none"
          />
        ) : (
          <div className="font-medium text-sm truncate" title={project.name}>
            {project.name}
          </div>
        )}
        <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2">
          <span>{formatDate(project.updatedAt)}</span>
          {project.clipCount > 0 && (
            <span>· {project.clipCount} {plural(project.clipCount, 'клип', 'клипа', 'клипов')}</span>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          className="w-7 h-7 rounded bg-black/60 hover:bg-black/80 flex items-center justify-center text-white/80"
          title="Действия"
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 mt-1 z-20 bg-panel-2 border border-border rounded-lg shadow-2xl py-1 min-w-[150px] text-sm">
              <MenuItem
                label="Открыть"
                onClick={() => {
                  setMenuOpen(false);
                  onOpen();
                }}
              />
              <MenuItem
                label="Переименовать"
                onClick={() => {
                  setMenuOpen(false);
                  onStartRename();
                }}
              />
              <MenuItem
                label="Дублировать"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
              />
              <div className="h-px bg-border my-1" />
              <MenuItem
                label="Удалить"
                danger
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-panel-3 ${
        danger ? 'text-red-400 hover:text-red-300' : ''
      }`}
    >
      {label}
    </button>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
