/** Borde izquierdo arrastrable de un panel lateral (Comandos, Notas). */
export function PanelResize({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const move = (ev: MouseEvent) => onResize(width + (startX - ev.clientX));
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
      className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-[var(--selected)]"
    />
  );
}

/** Clases del panel: en ventanas angostas se superpone a la terminal en vez de achicarla. */
export const panelClass = (overlay: boolean) =>
  // @container: los paneles adaptan sus textos a su propio ancho (260 px o más), no al de la ventana.
  `@container shrink-0 flex flex-col border-l border-line bg-chrome ${overlay ? "absolute right-0 top-0 bottom-0 z-30 shadow-pop" : "relative"}`;
