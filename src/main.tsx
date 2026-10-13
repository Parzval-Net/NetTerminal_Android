import ReactDOM from "react-dom/client";
import App from "./App";

// Sin StrictMode: el doble montaje en desarrollo abriría cada conexión dos veces.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
