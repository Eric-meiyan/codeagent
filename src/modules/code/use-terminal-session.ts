import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import { terminalWsUrl, type CodeSessionAgent } from './runtime';

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
  agent?: CodeSessionAgent;
  model?: string;
  container: HTMLDivElement | null;
}

export function useTerminalSession({
  runtimeBase,
  userId,
  sessionId,
  agent,
  model,
  container,
}: Options): {
  status: TerminalStatus;
  focused: boolean;
  reconnect: () => void;
  focus: () => void;
  scrollToBottom: () => void;
  enterScrollback: () => void;
} {
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [focused, setFocused] = useState(false);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimersRef = useRef<number[]>([]);

  const sendResize = useCallback((redraw = false) => {
    const term = termRef.current;
    const fit = fitRef.current;
    const socket = socketRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })
      );
      if (redraw) {
        socket.send(JSON.stringify({ type: 'input', data: '\x0c' }));
      }
    }
  }, []);

  const queueResize = useCallback(
    (delayMs: number, redraw = false) => {
      const timer = window.setTimeout(() => {
        resizeTimersRef.current = resizeTimersRef.current.filter(
          (item) => item !== timer
        );
        window.requestAnimationFrame(() => sendResize(redraw));
      }, delayMs);
      resizeTimersRef.current.push(timer);
    },
    [sendResize]
  );

  const scheduleResizeBurst = useCallback(
    (redraw = false) => {
      [0, 80, 250, 600, 1200].forEach((delayMs, index) => {
        queueResize(delayMs, redraw && index >= 2);
      });
    },
    [queueResize]
  );

  const sendInput = useCallback((data: string) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  const scrollToBottom = useCallback(() => {
    termRef.current?.scrollToBottom();
    termRef.current?.focus();
  }, []);

  const enterScrollback = useCallback(() => {
    // tmux copy-mode is the reliable scrollback path for full-screen TUIs.
    sendInput('\x02[');
    termRef.current?.focus();
  }, [sendInput]);

  const configureTmux = useCallback(() => {
    // These are tmux commands, sent via the default Ctrl-B prefix. They make
    // mouse-wheel scrolling work in copy-mode and stop stale tiny clients from
    // pinning the session to an old row count.
    ['set -g mouse on', 'set -g aggressive-resize on'].forEach(
      (command, index) => {
        const timer = window.setTimeout(
          () => {
            resizeTimersRef.current = resizeTimersRef.current.filter(
              (item) => item !== timer
            );
            sendInput(`\x02:${command}\r`);
          },
          120 + index * 120
        );
        resizeTimersRef.current.push(timer);
      }
    );
  }, [sendInput]);

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
    const socket = new WebSocket(
      terminalWsUrl(runtimeBase, userId, sessionId, agent, model)
    );
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return;
      setStatus('connected');
      scheduleResizeBurst(true);
      configureTmux();
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
  }, [
    runtimeBase,
    userId,
    sessionId,
    agent,
    model,
    scheduleResizeBurst,
    configureTmux,
  ]);

  const reconnect = useCallback(() => connect(), [connect]);

  useEffect(() => {
    let disposed = false;
    let removeWindowResize: (() => void) | null = null;
    if (!container) return;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        cursorInactiveStyle: 'outline',
        convertEol: false,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        letterSpacing: 0,
        lineHeight: 1.15,
        scrollback: 5000,
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
        sendInput(data);
      });
      term.onFocus(() => setFocused(true));
      term.onBlur(() => setFocused(false));

      termRef.current = term;
      fitRef.current = fit;
      scheduleResizeBurst();
      document.fonts?.ready
        .then(() => {
          if (!disposed) scheduleResizeBurst(true);
        })
        .catch(() => undefined);

      // The terminal's real pixel size settles after hydration/layout and can
      // change without a window resize (side panels, font load, breakpoints).
      // Track the container directly so xterm's cols/rows stay in sync with the
      // dimensions we report to the PTY — otherwise Claude/tmux draw at the
      // wrong width/height and the TUI renders garbled. Fires once on observe.
      const resizeObserver = new ResizeObserver(() => scheduleResizeBurst());
      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;
      const onWindowResize = () => scheduleResizeBurst();
      window.addEventListener('resize', onWindowResize);
      removeWindowResize = () =>
        window.removeEventListener('resize', onWindowResize);
      connect();
    })();

    return () => {
      disposed = true;
      removeWindowResize?.();
      resizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      resizeTimersRef.current = [];
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Re-init on session change so "new session" starts a fresh terminal.
  }, [sessionId, agent, connect, scheduleResizeBurst, container, sendInput]);

  return { status, focused, reconnect, focus, scrollToBottom, enterScrollback };
}
