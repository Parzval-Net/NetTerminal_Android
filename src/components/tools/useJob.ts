import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface JobEvent {
  job: string;
  kind: "line" | "done" | "error" | "result";
  text: string;
  data?: unknown;
}

/** Sigue un proceso del backend (traceroute, iperf, speedtest) por sus eventos. */
export function useJob<R = unknown, P = unknown>() {
  const [job, setJob] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<P | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    const un = listen<JobEvent>("tool-job", ({ payload: e }) => {
      if (e.job !== jobRef.current) return;
      if (e.kind === "line") {
        if (e.data) setProgress(e.data as P);
        if (e.text) setLines((l) => [...l.slice(-2000), e.text]);
      } else if (e.kind === "result") setResult(e.data as R);
      else if (e.kind === "error") setError(e.text);
      else if (e.kind === "done") {
        if (e.text) setLines((l) => [...l, e.text]);
        jobRef.current = null;
        setJob(null);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const start = useCallback(async (command: string, args: Record<string, unknown> = {}) => {
    setLines([]);
    setResult(null);
    setError(null);
    setProgress(null);
    try {
      const id = await invoke<string>(command, args);
      jobRef.current = id;
      setJob(id);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const stop = useCallback(() => {
    if (jobRef.current) invoke("tool_stop", { job: jobRef.current });
    jobRef.current = null;
    setJob(null);
  }, []);

  useEffect(() => () => {
    if (jobRef.current) invoke("tool_stop", { job: jobRef.current });
  }, []);

  return { running: job !== null, lines, progress, result, error, start, stop };
}
