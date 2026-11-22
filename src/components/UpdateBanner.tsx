import { useEffect, useState } from 'react';
import type { UpdateState } from '../types';

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} МБ`;
}

/**
 * Плашка в правом нижнем углу: появляется сама, когда на GitHub вышла новая
 * версия, или по пункту меню «Проверить обновления…».
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [manual, setManual] = useState(false);
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    void window.vp.updates.getState().then((s) => setState(s as UpdateState));
    const off1 = window.vp.updates.onState((s) => setState(s as UpdateState));
    const off2 = window.vp.updates.onShowPanel(() => {
      setManual(true);
      setHidden(null);
    });
    return () => {
      off1();
      off2();
    };
  }, []);

  const busy = state.status === 'downloading' || state.status === 'installing';
  const show =
    busy ||
    (state.status === 'available' && hidden !== state.version) ||
    (manual && state.status !== 'idle');
  if (!show) return null;

  function close() {
    setManual(false);
    if (state.status === 'available') setHidden(state.version);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-panel-2 shadow-2xl p-3 text-xs text-gray-200">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-white">
          {state.status === 'checking' && 'Проверяю обновления…'}
          {state.status === 'latest' && `У вас последняя версия — ${state.version}`}
          {state.status === 'available' && `Вышла версия ${state.version}`}
          {state.status === 'downloading' && `Скачиваю ${state.version}…`}
          {state.status === 'installing' && `Устанавливаю ${state.version}…`}
          {state.status === 'error' && 'Обновление не удалось'}
          {state.status === 'unsupported' && 'Обновление недоступно'}
        </div>
        {!busy && (
          <button onClick={close} className="text-gray-500 hover:text-white" title="Скрыть">
            ✕
          </button>
        )}
      </div>

      {state.status === 'available' && (
        <>
          {state.notes && (
            <div className="mt-2 max-h-28 overflow-y-auto whitespace-pre-line text-gray-400">{state.notes}</div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-gray-500">{state.sizeBytes ? mb(state.sizeBytes) : ''}</span>
            <button
              onClick={() => void window.vp.updates.install().catch(() => {})}
              className="px-3 py-1 rounded bg-accent hover:bg-accent/80 text-white"
              title="Скачать, установить и перезапустить. Открытый проект сохранится."
            >
              Обновить и перезапустить
            </button>
          </div>
        </>
      )}

      {state.status === 'downloading' && (
        <div className="mt-2">
          <div className="h-1 bg-panel-3 rounded overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${state.progress * 100}%` }} />
          </div>
          <div className="mt-1 text-gray-500">{Math.round(state.progress * 100)}%</div>
        </div>
      )}

      {state.status === 'installing' && (
        <div className="mt-2 text-gray-400">Проект сохранится, VideoPilot закроется и откроется уже новой версией.</div>
      )}

      {(state.status === 'error' || state.status === 'unsupported') && (
        <div className="mt-2 text-red-300 break-words">{state.message}</div>
      )}
    </div>
  );
}
