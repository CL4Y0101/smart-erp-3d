'use client';

import { useEffect, useRef } from 'react';
import { SIM_HTML } from '../lib/simHtml';
import { initSimulation } from '../lib/simulation';

/**
 * Simulasi lantai pabrik 3D Smart ERP.
 * Markup + logika simulasi di-port dari build statis; Three.js diambil dari npm.
 * Dijalankan di useEffect supaya cuma jalan di client (butuh WebGL/DOM).
 */
export default function FactorySimulation() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    root.innerHTML = SIM_HTML;
    const cleanup = initSimulation();

    return () => {
      try {
        if (typeof cleanup === 'function') cleanup();
      } catch (e) {
        /* abaikan */
      }
      root.innerHTML = '';
    };
  }, []);

  return <div ref={rootRef} className="sim-root" />;
}
