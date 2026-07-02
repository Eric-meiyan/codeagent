import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import { terminalWsUrl } from './runtime';

export type TerminalStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error';

interface Options {
  runtimeBase: string;
  userId: string;
  sessionId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useTerminalSession({
  runtimeBase,
  userId,
  sessionId,
  containerRef,
}: Options): { status: TerminalStatus; reconnect: () => void } {
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const socket = socketRef.current;
    if (!term || !fit) return;
    fit.fit();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })
      );
    }
  }, []);

  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (!sessionId) {
      term.clear();
      setStatus('idle');
      return;
    }
    setStatus('connecting');
    const socket = new WebSocket(terminalWsUrl(runtimeBase, userId, sessionId));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return;
      setStatus('connected');
      sendResize();
      // xterm only emits onData (keystrokes) while its helper textarea holds
      // focus; focus on connect so the user can type without clicking first.
      term.focus();
    });
    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return;
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data as ArrayBuffer));
      }
    });
    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return;
      setStatus('closed');
    });
    socket.addEventListener('error', () => {
      if (socketRef.current !== socket) return;
      setStatus('error');
    });
  }, [runtimeBase, userId, sessionId, sendResize]);

  const reconnect = useCallback(() => connect(), [connect]);

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        theme: {
          background: '#17130f',
          foreground: '#f4eadf',
          cursor: '#ffffff',
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      fit.fit();
      term.focus();
      term.onData((data) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      termRef.current = term;
      fitRef.current = fit;

      // The terminal's real pixel size settles after hydration/layout and can
      // change without a window resize (side panels, font load, breakpoints).
      // Track the container directly so xterm's cols/rows stay in sync with the
      // dimensions we report to the PTY — otherwise Claude/tmux draw at the
      // wrong width/height and the TUI renders garbled. Fires once on observe.
      const resizeObserver = new ResizeObserver(() => sendResize());
      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;
      window.addEventListener('resize', sendResize);
      connect();
    })();

    return () => {
      disposed = true;
      window.removeEventListener('resize', sendResize);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Re-init on session change so "new session" starts a fresh terminal.
  }, [sessionId, connect, sendResize, containerRef]);

  return { status, reconnect };
}
