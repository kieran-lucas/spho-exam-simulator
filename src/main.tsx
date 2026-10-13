import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/vietnamese-400.css";
import "@fontsource/inter/vietnamese-500.css";
import "@fontsource/inter/vietnamese-600.css";
import "@fontsource/noto-serif/latin-400.css";
import "@fontsource/noto-serif/latin-600.css";
import "@fontsource/noto-serif/latin-400-italic.css";
import "@fontsource/noto-serif/vietnamese-400.css";
import "@fontsource/noto-serif/vietnamese-600.css";
import "@fontsource/noto-serif/vietnamese-400-italic.css";
import "katex/dist/katex.min.css";
import "./styles.css";
import App from "./App";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <main className="startup">
        <h1>Unable to display this screen</h1>
        <p role="alert">{this.state.error}</p>
        <p>
          Your durable progress is stored locally. Restart the application to
          recover.
        </p>
        <button onClick={() => window.location.reload()}>
          Reload application
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
