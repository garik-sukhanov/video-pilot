import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { MediaBin } from './components/MediaBin';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { ExportModal } from './components/ExportModal';
import { ColorPanel } from './components/ColorPanel';
import { ProjectsScreen } from './components/ProjectsScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { useAppStore } from './appStore';
import { installQuitFlush, saveCurrentProject } from './projectIO';
import { installAgentBridge } from './agentBridge';
import { importPaths, isFileDrag, pathsFromDrop } from './mediaImport';

export function App() {
  const view = useAppStore((s) => s.view);

  // Wire the quit handshake once.
  useEffect(() => {
    installQuitFlush();
    installAgentBridge();
  }, []);

  // Файлы из Finder, брошенные в любое место редактора, — в исходники.
  // Без этого Chromium открыл бы файл в окне вместо проекта.
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = useAppStore.getState().view === 'editor' ? 'copy' : 'none';
      }
    }
    function onDrop(e: DragEvent) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      if (useAppStore.getState().view !== 'editor' || !e.dataTransfer) return;
      void importPaths(pathsFromDrop(e.dataTransfer));
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Manual save (Cmd/Ctrl+S) while the editor is open.
  useEffect(() => {
    if (view !== 'editor') return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveCurrentProject();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view]);

  if (view === 'projects') {
    return (
      <>
        <ProjectsScreen />
        <UpdateBanner />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-panel text-white text-sm">
      <UpdateBanner />
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <div className="w-72 border-r border-border bg-panel-2 flex flex-col min-h-0">
          <MediaBin />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 bg-black">
            <Preview />
          </div>
        </div>
      </div>
      <div className="h-72 border-t border-border bg-panel-2">
        <Timeline />
      </div>
      <ExportModal />
      <ColorPanel />
    </div>
  );
}
