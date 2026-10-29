/**
 * Rueda del mapa de Topología. La rueda vertical hace zoom sin distinguir mouse de touchpad (no hay
 * forma fiable: WebKit entrega la rueda en múltiplos de 4,000244 px solo sin aceleración, y Magic Mouse
 * o los mouse con desplazamiento suave dan deltas continuos). Se desplaza con Shift + rueda, con el
 * movimiento horizontal del touchpad o arrastrando el fondo; el pellizco (rueda con Ctrl) hace zoom.
 */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function wheelIntent(e: WheelLike): "zoom" | "pinch" | "pan" {
  if (e.ctrlKey || e.metaKey) return "pinch";
  return e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "pan" : "zoom";
}

/** Factor de zoom de un evento de rueda: un paso de rueda (100 px) cambia un 16 %; el pellizco es más fino. */
export function wheelFactor(e: Pick<WheelLike, "deltaY" | "deltaMode">, pinch: boolean): number {
  if (pinch) {
    const d = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    return Math.exp(-d * 0.01);
  }
  const d = Math.max(-300, Math.min(300, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
  return Math.exp(-d * 0.0015);
}
