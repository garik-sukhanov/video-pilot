import { useAppStore } from './appStore';
import { applyExternalDocument, buildDocument, closeToProjects, openProject } from './projectIO';
import type { ProjectDocument } from './types';

async function handle(op: string, payload: unknown): Promise<unknown> {
  const app = useAppStore.getState();
  switch (op) {
    case 'state':
      return {
        view: app.view,
        projectId: app.current?.id ?? null,
        name: app.current?.name ?? null,
        dirty: app.dirty,
      };
    case 'getDocument':
      return buildDocument();
    case 'applyDocument':
      await applyExternalDocument(payload as ProjectDocument);
      return true;
    case 'open': {
      const id = payload as string;
      if (app.current?.id === id) return true;
      if (app.current) await closeToProjects();
      await openProject(id);
      return true;
    }
    default:
      throw new Error(`неизвестная операция ${op}`);
  }
}

/** Answer requests from the local agent API (electron/agent.ts). */
let installed = false;

export function installAgentBridge() {
  if (installed) return;
  installed = true;
  window.vp.onAgentRequest((id, op, payload) => {
    handle(op, payload)
      .then((data) => window.vp.agentReply(id, true, data))
      .catch((e: Error) => window.vp.agentReply(id, false, e.message));
  });
}
