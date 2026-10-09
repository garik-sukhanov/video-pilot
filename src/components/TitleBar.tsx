import { useStore } from '../store';
import { useAppStore } from '../appStore';
import { closeToProjects, saveCurrentProject } from '../projectIO';

export function TitleBar() {
  const setExportOpen = useStore((s) => s.setExportModalOpen);
  const hasClips = useStore((s) => s.clips.length > 0);

  const projectName = useAppStore((s) => s.current?.name ?? 'Без названия');
  const dirty = useAppStore((s) => s.dirty);
  const saving = useAppStore((s) => s.saving);

  const status = saving ? 'Сохранение…' : dirty ? '• не сохранено' : 'Сохранено';

  return (
    <div className="titlebar-drag h-10 flex items-center border-b border-border bg-panel relative px-4">
      <div className="absolute left-20 no-drag flex items-center gap-2">
        <button
          onClick={() => void closeToProjects()}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-panel-3 transition-colors"
          title="К списку проектов (с сохранением)"
        >
          <span className="text-sm leading-none">‹</span> Проекты
        </button>
        <div className="w-px h-4 bg-border" />
        <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
          <span className="text-accent text-[10px] font-bold">VP</span>
        </div>
      </div>

      <div className="flex-1 text-center text-xs flex items-center justify-center gap-2">
        <span className="text-gray-300 font-medium truncate max-w-[280px]" title={projectName}>
          {projectName}
        </span>
        <button
          onClick={() => void saveCurrentProject()}
          className={`no-drag text-[10px] px-1.5 py-0.5 rounded transition-colors ${
            dirty && !saving
              ? 'text-accent-2 hover:bg-panel-3'
              : 'text-gray-600 cursor-default'
          }`}
          title="Сохранить (Cmd+S)"
        >
          {status}
        </button>
      </div>

      <div className="no-drag flex items-center gap-2">
        <button
          onClick={() => setExportOpen(true)}
          disabled={!hasClips}
          className="px-3 py-1 text-xs rounded bg-accent hover:bg-accent/80 disabled:opacity-30 text-white transition-colors"
          title="Экспортировать проект в MP4"
        >
          ⬇ Экспорт
        </button>
      </div>
    </div>
  );
}
