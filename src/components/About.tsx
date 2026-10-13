import interLicense from "../../licenses/Inter-OFL.txt?raw";
import serifLicense from "../../licenses/Noto-Serif-OFL.txt?raw";
import katexLicense from "../../licenses/KaTeX-MIT.txt?raw";
import { Modal } from "./Modal";
export function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About SPhO Exam Simulator" onClose={onClose}>
      <p>Version 1.0.0 · Offline Windows physics examination practice.</p>
      <p className="muted small">
        All question data and attempt history are stored locally. The interface
        includes the following locally bundled fonts and mathematical
        typesetting resources.
      </p>
      {[
        ["Inter · SIL Open Font License", interLicense],
        ["Noto Serif · SIL Open Font License", serifLicense],
        ["KaTeX · MIT License", katexLicense],
      ].map(([name, text]) => (
        <details className="license-text" key={name}>
          <summary>{name}</summary>
          <pre>{text}</pre>
        </details>
      ))}
    </Modal>
  );
}
