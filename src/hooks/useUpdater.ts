import { useCallback, useEffect, useRef, useState } from "react";
import { getUpdaterState, INITIAL_UPDATE_STATE, listenUpdaterState, type UpdateState } from "../lib/updater";

export function useUpdater() {
  const [state, setState] = useState(INITIAL_UPDATE_STATE);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const revision = useRef(0);
  const activeRef = useRef(true);
  const execute = useCallback(async (operation: () => Promise<UpdateState>) => {
    const requestRevision = ++revision.current;
    const value = await operation();
    if (activeRef.current && revision.current === requestRevision) { setState(value); setConnectionError(null); }
  }, []);
  useEffect(() => {
    activeRef.current = true;
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      const requestRevision = ++revision.current;
      void getUpdaterState().then(value => { if (active && revision.current === requestRevision) { setState(value); setConnectionError(null); } }).catch(error => { if (active && revision.current === requestRevision) setConnectionError(String(error)); });
    };
    void listenUpdaterState(value => { if (active) { revision.current++; setState(value); setConnectionError(null); } }).then(stop => { if (active) { unlisten = stop; sync(); } else stop(); }).catch(error => { if (active) { setConnectionError(String(error)); sync(); } });
    window.addEventListener("focus", sync);
    return () => { activeRef.current = false; revision.current++; active = false; unlisten?.(); window.removeEventListener("focus", sync); };
  }, []);
  return { state, execute, connectionError };
}
