import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { MediaBin } from './components/MediaBin';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { ExportModal } from './components/ExportModal';
import { ColorPanel } from './components/ColorPanel';
import { ProjectsScreen } from './components/ProjectsScreen';
import { useAppStore } from './appStore';
import { installQuitFlush, saveCurrentProject } from './projectIO';

export function App() {
  const view = useAppStore((s) => s.view);

  // Wire the quit handshake once.
  useEffect(() => {
    installQuitFlush();
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
    return <ProjectsScreen />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-panel text-white text-sm">
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
