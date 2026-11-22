import { useEffect, useState } from 'react';
import { useStore, formatTime } from '../store';
import type { MediaAsset } from '../types';
import { importPaths, isFileDrag, useImportStore } from '../mediaImport';

/** Идёт ли сейчас перетаскивание файлов из Finder над окном. */
function useFileDragOver(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const done = () => {
      depth = 0;
      setOver(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    // capture: бросок на дорожку таймлайна останавливает всплытие, а погасить подсветку нужно всё равно
    window.addEventListener('drop', done, true);
    window.addEventListener('dragend', done, true);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', done, true);
      window.removeEventListener('dragend', done, true);
    };
  }, []);
  return over;
}

export function MediaBin() {
  const assets = useStore((s) => s.assets);
  const removeAsset = useStore((s) => s.removeAsset);
  const relinkAsset = useStore((s) => s.relinkAsset);
  const selectAsset = useStore((s) => s.selectAsset);
  const toggleAssetInSelection = useStore((s) => s.toggleAssetInSelection);
  const selectAssetRange = useStore((s) => s.selectAssetRange);
  const clearAssetSelection = useStore((s) => s.clearAssetSelection);
  const selectedAssetIds = useStore((s) => s.selectedAssetIds);

  const progress = useImportStore((s) => s.progress);
  const notice = useImportStore((s) => s.notice);
  const error = useImportStore((s) => s.error);
  const fileDragOver = useFileDragOver();

  async function handleImport() {
    try {
      const paths = await window.vp.openMediaDialog();
      await importPaths(paths);
    } catch (e) {
      useImportStore.getState().setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRelink(asset: MediaAsset) {
    const newPath = await window.vp.relinkMediaDialog(asset.fileName);
    if (!newPath) return;
    relinkAsset(asset.id, newPath);
    // refresh waveform from the new location
    if (asset.probe.hasAudio) {
      window.vp
        .extractWaveform(newPath)
        .then((peaks) => useStore.getState().setWaveform(asset.id, peaks))
        .catch(() => {});
    }
  }

  function handleAssetClick(e: React.MouseEvent, asset: MediaAsset) {
    if (e.shiftKey) {
      e.preventDefault();
      selectAssetRange(asset.id);
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleAssetInSelection(asset.id);
    } else {
      selectAsset(asset.id);
    }
  }

  const importing = progress !== null && progress.done < progress.total;
  const selectedCount = selectedAssetIds.length;

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {fileDragOver && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/15 text-center text-sm text-white">
          Отпустите —
          <br />
          файлы добавятся в исходники
        </div>
      )}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-gray-400">
          Исходники{selectedCount > 1 ? ` · ${selectedCount} выбрано` : ''}
        </h2>
        <button
          onClick={handleImport}
          disabled={importing}
          className="px-3 py-1 text-xs rounded bg-accent hover:bg-accent/80 disabled:opacity-50 transition-colors"
        >
          + Импорт
        </button>
      </div>

      {progress && (
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
            <span className="truncate flex-1 mr-2">
              {importing
                ? `Импорт ${progress.done + 1} из ${progress.total}: ${progress.currentName}`
                : 'Готово'}
            </span>
            <span>{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          <div className="h-1 bg-panel-3 rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {notice && (
        <div className="mx-3 mt-2 p-2 text-xs bg-yellow-900/30 border border-yellow-700/60 rounded text-yellow-200">
          {notice}
        </div>
      )}

      {error && (
        <div className="mx-3 mt-2 p-2 text-xs bg-red-900/30 border border-red-700 rounded text-red-300">
          {error}
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto p-2 space-y-1"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) clearAssetSelection();
        }}
      >
        {assets.length === 0 && !progress ? (
          <div className="text-center text-gray-500 text-xs mt-10 px-4">
            Перетащите сюда видео, аудио или целую папку из Finder — или нажмите «+ Импорт».
            <div className="mt-3 text-gray-600">
              Перетащите файл из этого списка на таймлайн.
              <br />
              Shift+клик — диапазон, Cmd+клик — точечно.
            </div>
          </div>
        ) : (
          assets.map((a) => (
            <AssetRow
              key={a.id}
              asset={a}
              selected={selectedAssetIds.includes(a.id)}
              onClick={(e) => handleAssetClick(e, a)}
              onRemove={() => removeAsset(a.id)}
              onRelink={() => handleRelink(a)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface RowProps {
  asset: MediaAsset;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onRemove: () => void;
  onRelink: () => void;
}

function AssetRow({ asset, selected, onClick, onRemove, onRelink }: RowProps) {
  const { probe } = asset;
  const missing = asset.missing === true;

  function handleDragStart(e: React.DragEvent) {
    if (missing) {
      e.preventDefault();
      return;
    }
    const state = useStore.getState();
    let ids: string[];
    if (state.selectedAssetIds.includes(asset.id)) {
      ids = state.selectedAssetIds;
    } else {
      state.selectAsset(asset.id);
      ids = [asset.id];
    }
    e.dataTransfer.setData('application/x-videopilot-asset-ids', JSON.stringify(ids));
    e.dataTransfer.setData('application/x-videopilot-asset', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
    if (ids.length > 1) {
      const ghost = document.createElement('div');
      ghost.style.cssText =
        'position:absolute;top:-9999px;left:-9999px;background:#7c5cff;color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;font-family:sans-serif;';
      ghost.textContent = `${ids.length} файла`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      setTimeout(() => document.body.removeChild(ghost), 0);
    }
  }

  return (
    <div
      draggable={!missing}
      onDragStart={handleDragStart}
      onClick={onClick}
      className={`group flex items-center gap-2 p-2 rounded transition-colors ${
        missing ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${
        selected
          ? 'bg-accent/20 border border-accent/50'
          : missing
            ? 'border border-red-700/50 bg-red-900/10'
            : 'hover:bg-panel-3 border border-transparent'
      }`}
      title={
        missing
          ? 'Файл не найден — перепривяжите источник'
          : 'Перетащите на таймлайн · Shift+клик — диапазон · Cmd+клик — точечно'
      }
    >
      <div className="w-14 h-9 bg-black rounded overflow-hidden flex items-center justify-center shrink-0 relative">
        {asset.thumbnail ? (
          <img
            src={asset.thumbnail}
            alt=""
            className={`w-full h-full object-cover ${missing ? 'opacity-40 grayscale' : ''}`}
            draggable={false}
          />
        ) : probe.hasVideo ? (
          <span className="text-[10px] text-gray-500">video</span>
        ) : (
          <span className="text-[10px] text-gray-500">audio</span>
        )}
        {missing && (
          <span className="absolute inset-0 flex items-center justify-center text-red-400 text-sm">
            ⚠
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate flex items-center gap-1" title={asset.fileName}>
          {asset.fileName}
        </div>
        {missing ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRelink();
            }}
            className="text-[10px] text-red-400 hover:text-red-300 underline"
            title="Указать новое расположение файла"
          >
            Файл не найден — перепривязать
          </button>
        ) : (
          <div className="text-[10px] text-gray-500 flex gap-2">
            <span>{formatTime(probe.durationSec)}</span>
            {probe.width && probe.height && (
              <span>
                {probe.width}×{probe.height}
              </span>
            )}
            {probe.fps && probe.hasVideo && <span>{Math.round(probe.fps)}fps</span>}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-1"
        title="Удалить из бина"
      >
        ✕
      </button>
    </div>
  );
}
