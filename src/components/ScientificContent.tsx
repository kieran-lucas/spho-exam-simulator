import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ZoomIn, Minus, Plus, Maximize } from "lucide-react";
import { api } from "../api";
import { remarkPlugins, rehypePlugins } from "../science";
import type { Block } from "../models";
import { Modal } from "./Modal";
const cache = new Map<string, Promise<string>>();
export function Figure({
  examId,
  src,
  alt,
  caption,
}: {
  examId: string;
  src: string;
  alt: string;
  caption?: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let alive = true;
    setError("");
    setUrl("");
    const key = `${examId}/${src}`;
    if (!cache.has(key)) cache.set(key, api.asset(examId, src));
    cache
      .get(key)!
      .then((v) => {
        if (alive) setUrl(v);
      })
      .catch((e) => {
        cache.delete(key);
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [examId, src]);
  return (
    <figure className="science-figure">
      {error ? (
        <p role="alert" className="figure-error">
          Figure unavailable: {src}. {error}
        </p>
      ) : url ? (
        <button
          className="figure-button"
          onClick={(e) => {
            e.stopPropagation();
            setZoom(1);
            setOpen(true);
          }}
          aria-label={`Enlarge figure: ${alt}`}
        >
          <img
            src={url}
            alt={alt}
            onError={() => setError("The image could not be decoded")}
          />
          <span className="zoom-hint">
            <ZoomIn size={14} /> Enlarge
          </span>
        </button>
      ) : (
        <p className="muted">Loading figure…</p>
      )}
      {caption && <figcaption>{caption}</figcaption>}
      {open && (
        <Modal title={alt} onClose={() => setOpen(false)} wide>
          <div className="zoom-toolbar">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              aria-label="Zoom out"
            >
              <Minus size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              aria-label="Zoom in"
            >
              <Plus size={16} />
            </button>
            <button onClick={() => setZoom(1)}>
              <Maximize size={16} /> Fit to window
            </button>
          </div>
          <div className={`lightbox ${zoom === 1 ? "fit" : ""}`}>
            <img
              src={url}
              alt={alt}
              style={
                zoom === 1
                  ? undefined
                  : {
                      width: `${zoom * 100}%`,
                      maxWidth: "none",
                      maxHeight: "none",
                    }
              }
            />
          </div>
          {caption && <p className="caption">{caption}</p>}
        </Modal>
      )}
    </figure>
  );
}
export function ScientificContent({
  blocks,
  examId,
}: {
  blocks: Block[];
  examId: string;
}) {
  return (
    <div className="scientific-content">
      {blocks.map((b, i) =>
        b.type === "markdown" ? (
          <ReactMarkdown
            key={i}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            skipHtml
            components={{
              a: ({ children }) => <span>{children}</span>,
              img: () => null,
            }}
          >
            {b.content}
          </ReactMarkdown>
        ) : (
          <Figure key={i} examId={examId} {...b} />
        ),
      )}
    </div>
  );
}
