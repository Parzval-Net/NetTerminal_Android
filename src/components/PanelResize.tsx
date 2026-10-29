/**
 * Borde arrastrable de un panel lateral (Comandos y Notas a la izquierda de su borde
 * derecho; la barra de sesiones usa `side="right"` en su borde derecho).
 */
export function PanelResize({
  width,
  onResize,
  side = "left",
}: {
  width: number;
  onResize: (w: number) => void;
  side?: "left" | "right";
}) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    // Panel a la derecha: arrastrar hacia la izquierda lo achica. Barra a la izquierda: al revés.
    const move = (ev: MouseEvent) =>
      onResize(side === "left" ? width + (startX - ev.clientX) : width + (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div
      onMouseDown={startDrag}
      title="Arrastra para cambiar el ancho"
      className={`absolute top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-[var(--selected)] ${side === "left" ? "-left-1" : "-right-1"}`}
    />
  );
}

/** Clases del panel: en ventanas angostas se superpone a la terminal en vez de achicarla. */
export const panelClass = (overlay: boolean) =>
  // @container: los paneles adaptan sus textos a su propio ancho (260 px o más), no al de la ventana.
  `@container shrink-0 flex flex-col border-l border-line bg-chrome ${overlay ? "absolute right-0 top-0 bottom-0 z-30 shadow-pop" : "relative"}`;
