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
  sessionId: string;
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
    setStatus('connecting');
    const socket = new WebSocket(terminalWsUrl(runtimeBase, userId, sessionId));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      setStatus('connected');
      sendResize();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data as ArrayBuffer));
      }
    });
    socket.addEventListener('close', () => setStatus('closed'));
    socket.addEventListener('error', () => setStatus('error'));
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
      term.onData((data) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      termRef.current = term;
      fitRef.current = fit;

      window.addEventListener('resize', sendResize);
      connect();
    })();

    return () => {
      disposed = true;
      window.removeEventListener('resize', sendResize);
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
